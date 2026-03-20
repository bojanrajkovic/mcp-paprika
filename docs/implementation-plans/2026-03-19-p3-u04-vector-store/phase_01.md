# Vector Store Implementation Plan — Phase 1

**Goal:** Implement VectorStoreError, contentHash, and the full VectorStore class with Vectra integration, hash persistence, and corruption recovery.

**Architecture:** Thin wrapper around Vectra's `LocalIndex` providing recipe-aware vector operations. VectorStore owns three concerns: embedding lifecycle (when/what to embed), vector storage (Vectra), and change detection (persisted content hash map). Constructor does no I/O; `init()` creates directories and loads state. Hash map is persisted atomically via temp-then-rename with fsync.

**Tech Stack:** TypeScript 5.9 (ESM, strict), Vectra ^0.9.0, zod (validation), node:crypto (SHA-256), node:fs/promises (atomic writes)

**Scope:** 1 of 2 phases from original design (Phase 1)

**Codebase verified:** 2026-03-20

**Project-specific guidance:** `/home/brajkovic/Projects/mcp-paprika/.ed3d/implementation-plan-guidance.md`

**Testing guidance:** CLAUDE.md (lines 78-85); test patterns in `src/cache/disk-cache.test.ts` (temp dirs via mkdtemp), `src/features/embeddings.test.ts` (MSW HTTP mocking), `src/tools/tool-test-utils.ts` (factory helpers), `src/cache/__fixtures__/recipes.ts` (recipe fixtures)

---

## Acceptance Criteria Coverage

This phase implements:

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

---

## Codebase Verification Findings

- ✓ `EmbeddingClient` exists at `src/features/embeddings.ts:69-186` with `embed()` and `embedBatch()` methods
- ✓ `recipeToEmbeddingText` exists at `src/features/embeddings.ts:199-219` accepting `(recipe, categoryNames)`
- ✓ `EmbeddingError`/`EmbeddingAPIError` at `src/features/embedding-errors.ts:14-37` — two-class hierarchy with `ErrorOptions`
- ✓ Vectra `^0.9.0` in `package.json:27` (production dependency)
- ✓ DiskCache atomic write pattern at `src/cache/disk-cache.ts:122-133` — temp file + fsync + rename
- ✓ DiskCache corruption recovery pattern at `src/cache/disk-cache.ts:60-88` — Zod safeParse, ENOENT check, stderr warning
- ✓ Recipe type at `src/paprika/types.ts:22-54` with `uid`, `hash`, and all required fields
- ✓ Error logging pattern: `process.stderr.write("[mcp-paprika:module] msg\n")` at `src/index.ts:20-21`, `src/paprika/sync.ts:163-164`
- ✓ Init lifecycle: constructor no-I/O, `init()` creates dirs — pattern at `src/cache/disk-cache.ts:45-88`
- ✓ XDG cache directory via `src/utils/xdg.ts:3,9-10` — `envPaths("mcp-paprika", { suffix: "" })`
- ✓ Files to create do NOT exist: `src/features/vector-store.ts`, `src/features/vector-store-errors.ts`

## External Dependency Findings

- ✓ Vectra `LocalIndex` constructor: `(folderPath: string)` — path to index directory
- ✓ `createIndex()` creates folder + `index.json`; throws `'Index already exists'` if exists without `deleteIfExists: true`
- ✓ `isIndexCreated()` returns `Promise<boolean>` — safe existence check
- ✓ `beginUpdate()`/`endUpdate()` bracket batch mutations; optional but improves perf
- ✓ `cancelUpdate()` discards staged changes without saving (synchronous, does not throw)
- ✓ `upsertItem({ id, vector, metadata })` — inserts or updates by `id`; returns `IndexItem`
- ✓ `deleteItem(id)` — silently no-ops on missing items (returns `void`)
- ✓ `queryItems(vector, query, topK, filter?)` — `query` is BM25 string (pass `""` for pure vector); returns `Array<QueryResult>` with `{ item, score }`
- ✓ `getItem(id)` returns `IndexItem | undefined`
- ✓ Metadata values: `number | string | boolean` only
- ✓ `QueryResult.item.metadata` contains stored metadata; `QueryResult.score` is cosine similarity (0-1)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: VectorStoreError class

**Verifies:** None (infrastructure — error class scaffolding)

**Files:**

- Create: `src/features/vector-store-errors.ts`

**Implementation:**

Create a single error class following the `EmbeddingError` pattern at `src/features/embedding-errors.ts:14-19`. The design calls for a two-class structure (base + API-specific), but VectorStore has no external API — a single class with `ErrorOptions` for cause chaining is sufficient.

```typescript
/**
 * Error class for vector store operations.
 *
 * Covers initialization failures, corruption recovery, and indexing errors.
 * Supports ES2024 ErrorOptions for cause chaining.
 */
export class VectorStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VectorStoreError";
  }
}
```

**Verification:**
Run: `pnpm typecheck`
Expected: No errors

**Commit:** `feat(vector-store): add VectorStoreError class (p3-u04)`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: contentHash pure function and type exports

**Verifies:** p3-u04-vector-store.AC5.1, p3-u04-vector-store.AC5.2, p3-u04-vector-store.AC5.3

**Files:**

- Create: `src/features/vector-store.ts`

**Implementation:**

Create the module with the `contentHash` pure function and the exported types (`SemanticResult`, `IndexingResult`). The `contentHash` function uses `node:crypto` to produce a SHA-256 hex digest of the embedding text.

Key design decisions:

- `contentHash` hashes the output of `recipeToEmbeddingText()`, not the raw recipe. This means changes to `directions` (excluded by `recipeToEmbeddingText`) don't trigger re-embedding, while changes to `ingredients` (included) do.
- Types use `readonly` properties per house style.

```typescript
import { createHash } from "node:crypto";

export type SemanticResult = {
  readonly uid: string;
  readonly score: number;
  readonly recipeName: string;
};

export type IndexingResult = {
  readonly indexed: number;
  readonly skipped: number;
  readonly total: number;
};

/**
 * Produce a stable SHA-256 hex digest of the given text.
 * Used to detect whether a recipe's embeddable fields have changed
 * since the last indexing run.
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
```

The `VectorStore` class will be added in the next task in the same file.

**Testing:**

Tests for `contentHash` are covered in Phase 2. The function is pure and deterministic — AC5.1 tests stability, AC5.2/AC5.3 test that only embeddable fields affect the hash (via `recipeToEmbeddingText`).

**Verification:**
Run: `pnpm typecheck`
Expected: No errors

**Commit:** `feat(vector-store): add contentHash function and result types (p3-u04)`

<!-- END_TASK_2 -->
<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->

### Task 3: VectorStore class — constructor and init()

**Verifies:** p3-u04-vector-store.AC1.1, p3-u04-vector-store.AC1.2, p3-u04-vector-store.AC1.3, p3-u04-vector-store.AC1.4

**Files:**

- Modify: `src/features/vector-store.ts` (add VectorStore class with constructor + init)

**Implementation:**

Add the `VectorStore` class to the existing `vector-store.ts` file. This task covers the constructor (no I/O) and `init()` method (creates Vectra index, loads hash map with corruption recovery).

The constructor accepts `cacheDir` (path to the parent cache directory) and an `EmbeddingClient` instance. The Vectra `LocalIndex` is created pointed at `{cacheDir}/vectors/`.

The hash map is a `Record<string, string>` (uid → content hash) persisted at `{cacheDir}/vectors/hash-index.json`. It follows the DiskCache pattern at `src/cache/disk-cache.ts:60-88`:

- ENOENT on first run → empty map
- Invalid JSON → log to stderr, back up to `.bak`, reset to empty
- Zod schema mismatch → log to stderr, back up to `.bak`, reset to empty

Vectra index corruption is detected when `isIndexCreated()` returns true but loading fails. Recovery: log to stderr, back up `vectors/` to `vectors.bak/`, recreate index, clear hash map.

Key imports and patterns:

- `LocalIndex` from `"vectra"` — Vectra's file-based vector index
- `z` from `"zod"` — for hash map schema validation
- `mkdir`, `readFile`, `rename`, `cp` from `"node:fs/promises"` — filesystem ops
- `join` from `"node:path"` — path construction
- `VectorStoreError` from `"./vector-store-errors.js"` — error wrapping
- `EmbeddingClient` from `"./embeddings.js"` — embedding provider

```typescript
import { mkdir, readFile, rename, cp } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import { LocalIndex } from "vectra";
import type { EmbeddingClient } from "./embeddings.js";
import { VectorStoreError } from "./vector-store-errors.js";

// ... (SemanticResult, IndexingResult, contentHash from Task 2) ...

const HashIndexSchema = z.record(z.string(), z.string());

/** Maximum number of texts to embed in a single batch call. */
const BATCH_SIZE = 500;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function log(msg: string): void {
  process.stderr.write(`[mcp-paprika:vectors] ${msg}\n`);
}

export class VectorStore {
  private readonly _vectorsDir: string;
  private readonly _hashIndexPath: string;
  private readonly _index: LocalIndex;
  private readonly _embedder: EmbeddingClient;
  private _hashes: Record<string, string> = {};

  constructor(cacheDir: string, embedder: EmbeddingClient) {
    this._vectorsDir = join(cacheDir, "vectors");
    this._hashIndexPath = join(this._vectorsDir, "hash-index.json");
    this._index = new LocalIndex(this._vectorsDir);
    this._embedder = embedder;
  }

  async init(): Promise<void> {
    await mkdir(this._vectorsDir, { recursive: true });

    // Create or open Vectra index, with corruption recovery (AC1.4)
    try {
      const created = await this._index.isIndexCreated();
      if (!created) {
        await this._index.createIndex();
      }
    } catch (error: unknown) {
      log("corrupt Vectra index, backing up and recreating");
      const backupDir = `${this._vectorsDir}.bak`;
      await cp(this._vectorsDir, backupDir, { recursive: true, force: true });
      await this._index.createIndex({ version: 1, deleteIfExists: true });
      this._hashes = {};
      return; // Skip loading hash index — just cleared everything
    }

    // Load hash map — follows DiskCache pattern (disk-cache.ts:60-88)
    await this._loadHashIndex();
  }

  private async _loadHashIndex(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this._hashIndexPath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this._hashes = {};
        return;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log("corrupt hash-index.json (invalid JSON), backing up and resetting");
      await this._backupFile(this._hashIndexPath, `${this._hashIndexPath}.bak`);
      this._hashes = {};
      return;
    }

    const result = HashIndexSchema.safeParse(parsed);
    if (!result.success) {
      log("corrupt hash-index.json (schema mismatch), backing up and resetting");
      await this._backupFile(this._hashIndexPath, `${this._hashIndexPath}.bak`);
      this._hashes = {};
      return;
    }

    this._hashes = result.data;
  }

  private async _backupFile(src: string, dest: string): Promise<void> {
    try {
      await rename(src, dest);
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}
```

**Verification:**
Run: `pnpm typecheck`
Expected: No errors

**Commit:** `feat(vector-store): add VectorStore constructor and init with corruption recovery (p3-u04)`

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: VectorStore — indexRecipes, indexRecipe, and hash persistence

**Verifies:** p3-u04-vector-store.AC2.1, p3-u04-vector-store.AC2.2, p3-u04-vector-store.AC2.3, p3-u04-vector-store.AC2.4, p3-u04-vector-store.AC2.5, p3-u04-vector-store.AC2.6

**Files:**

- Modify: `src/features/vector-store.ts` (add indexRecipes, indexRecipe, \_persistHashes, size getter)

**Implementation:**

Add the batch indexing method `indexRecipes()`, single-recipe `indexRecipe()`, atomic hash map persistence, and the `size` getter.

`indexRecipes()` flow:

1. Early return for empty array (AC2.5)
2. For each recipe: compute `contentHash(recipeToEmbeddingText(recipe, resolveCats(recipe.categories)))`
3. Filter: skip recipes where hash matches `this._hashes[recipe.uid]` (AC2.2)
4. Batch embed changed recipes in chunks of `BATCH_SIZE` (default 500) via `this._embedder.embedBatch(texts)` (AC2.1)
5. `beginUpdate()` → `upsertItem({ id: recipe.uid, vector, metadata: { recipeName: recipe.name } })` for each → `endUpdate()`
6. Update `this._hashes` for each indexed recipe
7. Persist hash map via `_persistHashes()` (AC2.4)
8. Return `IndexingResult` with counts (AC2.3)

`_persistHashes()` follows the DiskCache atomic write pattern at `src/cache/disk-cache.ts:122-133`:

- Write to temp file in same directory
- fsync the temp file
- Rename over target (atomic on same filesystem)

`indexRecipe()` is a convenience wrapper that calls `indexRecipes([recipe], () => categoryNames)`.

The `size` getter returns `Object.keys(this._hashes).length` — the number of recipes in the hash map.

```typescript
import { open } from "node:fs/promises"; // add to existing imports
import { recipeToEmbeddingText } from "./embeddings.js";
import type { Recipe, CategoryUid } from "../paprika/types.js";

// Inside VectorStore class:

async indexRecipes(
  recipes: ReadonlyArray<Recipe>,
  resolveCats: (uids: ReadonlyArray<CategoryUid>) => ReadonlyArray<string>,
): Promise<IndexingResult> {
  if (recipes.length === 0) {
    return { indexed: 0, skipped: 0, total: 0 };
  }

  // Compute embedding texts and hashes, filter unchanged
  const toEmbed: Array<{ recipe: Recipe; text: string; hash: string }> = [];
  let skipped = 0;

  for (const recipe of recipes) {
    const cats = resolveCats(recipe.categories);
    const text = recipeToEmbeddingText(recipe, cats);
    const hash = contentHash(text);

    if (this._hashes[recipe.uid] === hash) {
      skipped++;
      continue;
    }

    toEmbed.push({ recipe, text, hash });
  }

  if (toEmbed.length === 0) {
    return { indexed: 0, skipped, total: recipes.length };
  }

  // Batch embed in chunks of BATCH_SIZE to avoid API limits on large collections
  const allVectors: Array<Array<number>> = [];
  for (let offset = 0; offset < toEmbed.length; offset += BATCH_SIZE) {
    const chunk = toEmbed.slice(offset, offset + BATCH_SIZE);
    const vectors = await this._embedder.embedBatch(chunk.map((e) => e.text));
    allVectors.push(...vectors);
  }

  // Upsert into Vectra
  await this._index.beginUpdate();
  try {
    for (let i = 0; i < toEmbed.length; i++) {
      const entry = toEmbed[i]!;
      await this._index.upsertItem({
        id: entry.recipe.uid,
        vector: allVectors[i]!,
        metadata: { recipeName: entry.recipe.name },
      });
    }
    await this._index.endUpdate();
  } catch (error: unknown) {
    this._index.cancelUpdate();
    throw new VectorStoreError("Failed to upsert items into vector index", {
      cause: error instanceof Error ? error : undefined,
    });
  }

  // Update hash map
  for (const entry of toEmbed) {
    this._hashes[entry.recipe.uid] = entry.hash;
  }
  await this._persistHashes();

  return { indexed: toEmbed.length, skipped, total: recipes.length };
}

async indexRecipe(
  recipe: Readonly<Recipe>,
  categoryNames: ReadonlyArray<string>,
): Promise<IndexingResult> {
  return this.indexRecipes([recipe], () => [...categoryNames]);
}

get size(): number {
  return Object.keys(this._hashes).length;
}

private async _persistHashes(): Promise<void> {
  const tmpPath = join(this._vectorsDir, `.hash-index-${Date.now().toString()}.tmp`);
  const fh = await open(tmpPath, "w");
  try {
    await fh.writeFile(JSON.stringify(this._hashes, null, 2));
    await fh.sync();
  } finally {
    await fh.close();
  }
  await rename(tmpPath, this._hashIndexPath);
}
```

**Verification:**
Run: `pnpm typecheck`
Expected: No errors

**Commit:** `feat(vector-store): add indexRecipes with hash-based dedup and persistence (p3-u04)`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->

### Task 5: VectorStore — search and removeRecipe

**Verifies:** p3-u04-vector-store.AC3.1, p3-u04-vector-store.AC3.2, p3-u04-vector-store.AC3.3, p3-u04-vector-store.AC4.1, p3-u04-vector-store.AC4.2, p3-u04-vector-store.AC4.3

**Files:**

- Modify: `src/features/vector-store.ts` (add search and removeRecipe methods)

**Implementation:**

Add `search()` and `removeRecipe()` to the VectorStore class.

`search()` flow:

1. Embed the query text via `this._embedder.embed(query)`
2. Call `this._index.queryItems(vector, "", topK)` — empty string for BM25 query (pure vector search)
3. Map results to `SemanticResult[]` extracting `item.id` as uid, `score`, and `item.metadata.recipeName`
4. Vectra already returns results sorted by descending cosine similarity (AC3.2)
5. On empty index or no results, `queryItems` returns `[]` which maps to `[]` (AC3.3)

`removeRecipe()` flow:

1. Call `this._index.deleteItem(uid)` — Vectra silently no-ops on missing items (AC4.3)
2. Delete `uid` from `this._hashes`
3. Persist hash map via `_persistHashes()` (AC4.2)

```typescript
// Inside VectorStore class:

async search(query: string, topK: number = 10): Promise<ReadonlyArray<SemanticResult>> {
  const vector = await this._embedder.embed(query);
  const results = await this._index.queryItems(vector, "", topK);
  return results.map((r) => ({
    uid: r.item.id!,
    score: r.score,
    recipeName: (r.item.metadata?.recipeName as string) ?? "",
  }));
}

async removeRecipe(uid: string): Promise<void> {
  await this._index.deleteItem(uid);
  if (uid in this._hashes) {
    delete this._hashes[uid];
    await this._persistHashes();
  }
}
```

Note on `r.item.id!`: Vectra items always have an `id` when retrieved from the index (auto-generated UUID if not provided on insert). Since we always provide explicit `id` values on upsert, this is always populated.

Note on `r.item.metadata?.recipeName`: Metadata is typed as `Record<string, MetadataTypes>` by Vectra. We store `recipeName` as a string during upsert, so the cast is safe.

**Verification:**
Run: `pnpm typecheck`
Expected: No errors

Run: `pnpm lint`
Expected: No errors

**Commit:** `feat(vector-store): add search and removeRecipe methods (p3-u04)`

<!-- END_TASK_5 -->
<!-- END_SUBCOMPONENT_B -->
