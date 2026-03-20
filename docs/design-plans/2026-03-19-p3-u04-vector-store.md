# Vector Store Design

## Summary

This unit implements `VectorStore`, the component responsible for maintaining a local semantic search index of recipes. It wraps [Vectra](https://github.com/Stevenic/vectra)'s `LocalIndex` -- an on-disk vector database -- and adds three recipe-aware concerns on top: deciding which recipes need (re-)embedding by comparing content hashes, calling `EmbeddingClient` to obtain embedding vectors for changed recipes, and persisting both the vector index and a hash map to disk so that unchanged recipes survive application restarts without being re-embedded.

The design keeps `VectorStore` deliberately narrow in scope. It has no knowledge of the sync lifecycle or MCP tools -- it exposes three plain async methods (`indexRecipes`, `search`, `removeRecipe`) and is wired up by the entry point (P3-U08). Corruption in either the Vectra index or the hash map is handled gracefully: the affected artifact is backed up and rebuilt from scratch, so the store always returns to a consistent state even after unexpected writes or truncation.

## Definition of Done

1. A `VectorStore` class wrapping Vectra's `LocalIndex` with recipe-aware operations: batch indexing (with content-hash-based dedup), semantic search, and per-recipe removal
2. Persisted hash map (uid -> content hash of embedding text) to avoid re-embedding unchanged recipes across restarts
3. Corruption recovery: log error, back up corrupted index, recreate from scratch
4. Uses actual Vectra API (upsertItem, beginUpdate/endUpdate, indexed metadata) rather than the outdated spec assumptions
5. MSW/Vectra-mocked tests covering all acceptance criteria

## Acceptance Criteria

### p3-u04-vector-store.AC1: Initialization

- **p3-u04-vector-store.AC1.1 Success:** `init()` creates the Vectra index and empty hash map when neither exists (first run)
- **p3-u04-vector-store.AC1.2 Success:** `init()` loads existing hash map and opens existing Vectra index on subsequent runs
- **p3-u04-vector-store.AC1.3 Edge:** `init()` recovers from corrupted `hash-index.json` -- logs to stderr, backs up to `.bak`, resets to empty map
- **p3-u04-vector-store.AC1.4 Edge:** `init()` recovers from corrupted Vectra index -- logs to stderr, backs up `vectors/` to `vectors.bak/`, recreates index, clears hash map

### p3-u04-vector-store.AC2: Indexing with hash-based dedup

- **p3-u04-vector-store.AC2.1 Success:** `indexRecipes()` embeds and upserts recipes whose content hash has changed
- **p3-u04-vector-store.AC2.2 Success:** `indexRecipes()` skips recipes whose `contentHash(recipeToEmbeddingText(...))` matches the persisted value
- **p3-u04-vector-store.AC2.3 Success:** `indexRecipes()` returns `IndexingResult` with correct `indexed`, `skipped`, and `total` counts
- **p3-u04-vector-store.AC2.4 Success:** `indexRecipes()` persists updated hash map to `hash-index.json` after successful indexing
- **p3-u04-vector-store.AC2.5 Edge:** `indexRecipes([])` returns `{ indexed: 0, skipped: 0, total: 0 }` without calling embedBatch
- **p3-u04-vector-store.AC2.6 Edge:** Hash map persists across restarts -- new VectorStore instance loads previously saved hashes and skips unchanged recipes

### p3-u04-vector-store.AC3: Search

- **p3-u04-vector-store.AC3.1 Success:** `search(query, topK)` embeds the query and returns `SemanticResult[]` with uid, score, and recipeName
- **p3-u04-vector-store.AC3.2 Success:** Results are ordered by descending cosine similarity score
- **p3-u04-vector-store.AC3.3 Edge:** `search()` on empty index returns `[]` (not an error)

### p3-u04-vector-store.AC4: Removal

- **p3-u04-vector-store.AC4.1 Success:** `removeRecipe(uid)` deletes the item from Vectra and removes the uid from the hash map
- **p3-u04-vector-store.AC4.2 Success:** `removeRecipe(uid)` persists the updated hash map after removal
- **p3-u04-vector-store.AC4.3 Edge:** `removeRecipe(uid)` for a non-existent uid does not throw

### p3-u04-vector-store.AC5: Content hashing

- **p3-u04-vector-store.AC5.1 Success:** `contentHash()` produces a stable SHA-256 hex digest for the same input text
- **p3-u04-vector-store.AC5.2 Success:** A change to only `directions` (excluded from embedding text) does not change the content hash
- **p3-u04-vector-store.AC5.3 Success:** A change to `ingredients` (included in embedding text) does change the content hash

## Glossary

- **Vectra / `LocalIndex`**: A file-based vector database library. Stores embedding vectors and per-item metadata as JSON on disk. Provides `upsertItem`, `queryItems`, `beginUpdate`/`endUpdate` for managing a local vector index without an external database server.
- **Embedding vector**: A fixed-length array of floats produced by an AI model that encodes the semantic meaning of text. Similar texts produce geometrically close vectors.
- **Cosine similarity**: A measure of how close two embedding vectors are, ranging from 0 (unrelated) to 1 (identical meaning). Used by Vectra to rank search results.
- **Content hash**: A SHA-256 digest of the text that would be embedded for a given recipe. Used to detect whether embeddable fields have changed since the last sync.
- **Hash map (`hash-index.json`)**: A persisted JSON file mapping recipe UID to content hash. Acts as a change-detection index. If lost or corrupted it is rebuilt -- does not affect search accuracy.
- **Atomic write (temp + rename + fsync)**: Write to temp file, fsync, rename over target. Guarantees the file is never partially written if the process crashes.
- **`beginUpdate` / `endUpdate`**: Vectra API methods that bracket a batch of mutations. All `upsertItem` calls between them are committed atomically.
- **`upsertItem`**: Vectra method that inserts or replaces an existing item by ID.
- **`queryItems`**: Vectra method that performs k-nearest-neighbor search against stored vectors by cosine similarity.
- **BM25**: A keyword-based relevance ranking algorithm. Mentioned to clarify that search is purely vector-based (BM25 query string left empty).

## Architecture

Thin wrapper around Vectra's `LocalIndex` providing recipe-aware vector operations. VectorStore owns three concerns: embedding lifecycle (when to embed, what to embed), vector storage (Vectra), and change detection (persisted content hash map).

**Components:**

- **VectorStore** (`src/features/vector-store.ts`) — main class. Accepts `cacheDir` and `EmbeddingClient` in constructor (no I/O). `init()` creates Vectra index if needed and loads persisted hash map.
- **VectorStoreError** (`src/features/vector-store-errors.ts`) — error class for store-specific failures. Extends `Error` with `ErrorOptions` for cause chaining. Follows the `EmbeddingError` / `EmbeddingAPIError` pattern from P3-U03.
- **Hash map** (`{cacheDir}/vectors/hash-index.json`) — persisted `Record<string, string>` mapping recipe UID to SHA-256 content hash of embedding text. Loaded on `init()`, updated after successful indexing, persisted via atomic write (temp + rename + fsync).

**Data flow:**

```
sync:complete event (from SyncEngine)
  |
  v
Entry wiring (P3-U08) calls vectorStore.indexRecipes(recipes, resolveCats)
  |
  v
VectorStore:
  1. For each recipe: compute contentHash(recipeToEmbeddingText(recipe, categories))
  2. Filter: skip recipes where hash matches persisted value
  3. Batch embed remaining texts via EmbeddingClient.embedBatch()
  4. beginUpdate() -> upsertItem() for each -> endUpdate()
  5. Update in-memory hash map
  6. Persist hash map to disk (atomic write)
```

**Search flow:**

```
discover_recipes tool (P3-U06) calls vectorStore.search(query, topK)
  |
  v
VectorStore:
  1. Embed query via EmbeddingClient.embed()
  2. queryItems(vector, '', topK) — pure semantic, no BM25
  3. Map to SemanticResult[] { uid, score, recipeName }
```

**Contracts:**

```typescript
interface SemanticResult {
  readonly uid: string;
  readonly score: number; // cosine similarity, 0-1
  readonly recipeName: string;
}

interface IndexingResult {
  readonly indexed: number; // recipes that were (re-)embedded
  readonly skipped: number; // recipes with unchanged hash
  readonly total: number; // input count
}

class VectorStore {
  constructor(cacheDir: string, embedder: EmbeddingClient);
  init(): Promise<void>;
  indexRecipes(
    recipes: ReadonlyArray<Recipe>,
    resolveCats: (uids: ReadonlyArray<string>) => ReadonlyArray<string>,
  ): Promise<IndexingResult>;
  indexRecipe(recipe: Readonly<Recipe>, categoryNames: ReadonlyArray<string>): Promise<IndexingResult>;
  search(query: string, topK?: number): Promise<ReadonlyArray<SemanticResult>>;
  removeRecipe(uid: string): Promise<void>;
  get size(): number;
}
```

**On-disk layout:**

```
$XDG_CACHE_HOME/paprika-mcp/
├── index.json                   # DiskCache recipe hash index (Phase 1)
├── recipes/                     # Cached recipe JSON (Phase 1)
├── categories/                  # Cached category JSON (Phase 1)
└── vectors/                     # Vectra index directory
    ├── index.json               # Vectra's internal vector index
    ├── hash-index.json          # uid -> contentHash (our persistence)
    └── {item-guid}.json         # Per-item metadata files (Vectra-managed)
```

## Existing Patterns

**DiskCache index persistence** (`src/cache/disk-cache.ts:22-133`): Hash map load/save follows this pattern exactly — Zod schema validation, try/catch with ENOENT check for first-run, stderr warning + reset for corruption, atomic writes via temp-then-rename with fsync.

**Init lifecycle** (`src/cache/disk-cache.ts`, `src/index.ts:43-44`): Constructor does no I/O. `init()` creates directories and loads persisted state. Same pattern used here.

**Error logging** (`src/index.ts:20-22`, `src/paprika/sync.ts:163-164`): `process.stderr.write("[mcp-paprika:vectors] ...")` with module prefix. No console.log (stdio transport).

**Error class hierarchy** (`src/features/embedding-errors.ts`): `VectorStoreError` follows the same two-class structure (base + API-specific). Uses `ErrorOptions` for cause chaining.

**Sync event subscription** (`src/paprika/sync.ts:7-21`): VectorStore does not subscribe to events directly — P3-U08 entry wiring calls `vectorStore.indexRecipes()` inside its `sync:complete` handler. This keeps VectorStore decoupled from the sync lifecycle.

**Category resolution callback** (`src/cache/recipe-store.ts`): VectorStore accepts a `resolveCats` function parameter instead of importing RecipeStore. Same decoupling pattern used by the sync engine.

**Divergence from P3-U04 unit spec:**

- Uses `upsertItem()` instead of delete-then-insert (Vectra natively supports upsert)
- Wraps mutations in `beginUpdate()`/`endUpdate()` (required by actual Vectra API)
- Passes `query` string parameter to `queryItems()` (actual Vectra signature)
- Hashes embedding text content instead of using `recipe.hash` (more precise change detection)
- Persists hash map to disk (spec said in-memory only)
- Returns `IndexingResult` from `indexRecipes()` instead of void

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: VectorStore Implementation

**Goal:** Implement `VectorStoreError`, the `contentHash` pure function, and the full `VectorStore` class with Vectra integration, hash persistence, and corruption recovery.

**Components:**

- `VectorStoreError` in `src/features/vector-store-errors.ts` — error class with `ErrorOptions` support
- `contentHash()` pure function in `src/features/vector-store.ts` — SHA-256 hex digest of embedding text
- `VectorStore` class in `src/features/vector-store.ts` — full implementation: init, indexRecipes, indexRecipe, search, removeRecipe, size getter
- Hash map persistence: load on init (Zod-validated, corruption-safe), atomic save after mutations
- Corruption recovery: backup + recreate for both Vectra index and hash map
- Vectra integration using actual API: `beginUpdate()`/`endUpdate()`, `upsertItem()`, `queryItems(vector, '', topK)`

**Verifies:** p3-u04-vector-store.AC1, p3-u04-vector-store.AC2, p3-u04-vector-store.AC3, p3-u04-vector-store.AC4, p3-u04-vector-store.AC5

**Dependencies:** P3-U01 (vectra installed), P3-U03 (EmbeddingClient, recipeToEmbeddingText)

**Done when:** `pnpm typecheck` and `pnpm lint` pass. All tests from Phase 2 pass.

<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->

### Phase 2: Tests and Final Verification

**Goal:** Comprehensive test coverage for VectorStore using vi.mock('vectra') for unit tests and real temp directories for integration tests.

**Components:**

- Unit tests in `src/features/vector-store.test.ts` — mock Vectra `LocalIndex` via `vi.mock('vectra')`, mock `EmbeddingClient`, test hash filtering, batch logic, error handling, corruption recovery
- Integration tests in `src/features/vector-store.test.integration.ts` — real temp directories, real Vectra `LocalIndex`, mock `EmbeddingClient` (returns deterministic vectors), test end-to-end indexing and search
- Final verification: `pnpm typecheck`, `pnpm lint`, `pnpm test` (full suite)

**Verifies:** All ACs (p3-u04-vector-store.AC1 through AC5)

**Dependencies:** Phase 1

**Done when:** All tests pass, full suite green, typecheck and lint clean

<!-- END_PHASE_2 -->

## Additional Considerations

**Hash map is an optimization, not source of truth.** Vectra's index is the authoritative record of what's indexed. If the hash map is lost or corrupted, the only consequence is unnecessary re-embedding on next sync — search results are never affected.

**Batch size:** Configurable via constant (default 500). Provides a safety valve for very large collections without adding complexity. Single batch for typical 100-500 recipe collections.

**Error handling:** `VectorStore` throws `VectorStoreError` for store-specific failures (corruption, init failure). EmbeddingClient errors propagate through — callers (P3-U08) catch and handle. `search()` on an empty or uninitialized index returns `[]` rather than throwing. `removeRecipe()` on non-existent uid is a no-op.
