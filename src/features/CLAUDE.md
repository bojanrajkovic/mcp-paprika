# Feature Implementations

Last verified: 2026-05-22

## Purpose

Orchestrates business logic by composing the Paprika API client and caching layer. Provides high-level operations that tools and resources consume.

## Contracts

### embedding-errors.ts — Error hierarchy for embedding operations

Two-class hierarchy with ES2024 `ErrorOptions` cause chaining support.

| Class               | Extends          | Fields                                                 |
| ------------------- | ---------------- | ------------------------------------------------------ |
| `EmbeddingError`    | `Error`          | (base class for all embedding errors)                  |
| `EmbeddingAPIError` | `EmbeddingError` | `readonly status: number`, `readonly endpoint: string` |

### embeddings.ts — Embedding client and recipe-to-text conversion

`EmbeddingClient` is an HTTP client for OpenAI-compatible `/v1/embeddings` endpoints. Uses
cockatiel for resilience: exponential-backoff retry (3 attempts, 500ms-10s) on transient
HTTP errors (429, 500, 502, 503) and a circuit breaker (opens after 5 consecutive failures,
half-open after 30s). Validates responses with Zod at the boundary. Per-instance resilience
stack (no shared state between instances).

| Export                     | Signature / Description                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `EmbeddingClient`          | `constructor(config: Readonly<EmbeddingConfig>)` — resilient HTTP client |
| `.embed(text)`             | `Promise<Array<number>>` — embed a single text                           |
| `.embedBatch(texts)`       | `Promise<Array<Array<number>>>` — embed multiple texts in one call       |
| `.dimensions`              | `number` getter — throws `EmbeddingError` if no call made yet            |
| `EMBEDDING_SCHEMA_VERSION` | `number` constant — bump when `recipeToEmbeddingText` format changes     |
| `recipeToEmbeddingText`    | `(recipe, categoryNames) => string` — pure function, no I/O              |

**Invariants:**

- `EmbeddingClient` throws (does not return `Result`) because it wraps cockatiel which uses exceptions for control flow
- `recipeToEmbeddingText` includes name, description, categories, ingredients, notes; excludes directions and nutritional info
- **IMPORTANT:** When changing `recipeToEmbeddingText` (adding/removing fields, restructuring format), bump `EMBEDDING_SCHEMA_VERSION` so existing users get a full re-index on next startup
- `BrokenCircuitError` from cockatiel is caught and re-thrown as `EmbeddingAPIError` with status 503

### vector-store-errors.ts — Error hierarchy for vector store operations

Single error class with ES2024 `ErrorOptions` cause chaining support.

| Class              | Extends | Fields                         |
| ------------------ | ------- | ------------------------------ |
| `VectorStoreError` | `Error` | (base class for vector errors) |

### vector-store.ts — Vector store with semantic search and change detection

`VectorStore` wraps Vectra `LocalIndex` for local vector storage. Provides recipe indexing
with SHA-256 content-hash change detection (persisted to `hash-index.json`), batch embedding
via `EmbeddingClient`, semantic search, and corruption recovery (backs up and recreates on
corrupt Vectra index or hash-index.json).

| Export            | Signature / Description                                                                                                                                                                                                             |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contentHash`     | `(text: string) => string` — SHA-256 hex digest for change detection                                                                                                                                                                |
| `SemanticResult`  | `type { uid, score, recipeName }` — single search result                                                                                                                                                                            |
| `IndexingResult`  | `type { indexed, skipped, total }` — batch indexing summary                                                                                                                                                                         |
| `VectorStore`     | `constructor(cacheDir, embedder, modelId, schemaVersion, log?)` — vector store instance; `log` is an optional pino `Logger`, defaults to silent. Pass `appLog.child({ component: "vector-store" })` from `buildDiscoverComponents`. |
| `.init()`         | `Promise<void>` — creates directory, Vectra index, loads hash map; recovers from corruption                                                                                                                                         |
| `.indexRecipes()` | `Promise<IndexingResult>` — batch index with change detection, batches of 500                                                                                                                                                       |
| `.indexRecipe()`  | `Promise<IndexingResult>` — convenience single-recipe wrapper                                                                                                                                                                       |
| `.search()`       | `Promise<ReadonlyArray<SemanticResult>>` — semantic search, default topK=10                                                                                                                                                         |
| `.removeRecipe()` | `Promise<void>` — remove recipe from index and hash map                                                                                                                                                                             |
| `.clearHashes()`  | `void` — reset in-memory hash index to force full re-embedding                                                                                                                                                                      |
| `.size`           | `number` getter — count of indexed recipes (via hash map)                                                                                                                                                                           |

**Invariants:**

- `VectorStore` throws (does not return `Result`) because it wraps Vectra and `EmbeddingClient` which use exceptions
- Content hash uses SHA-256 of `recipeToEmbeddingText()` output; unchanged recipes are skipped during indexing
- Hash map persisted via atomic write (write-to-tmp + rename) following `DiskCache` pattern
- Corruption recovery: corrupt Vectra index is backed up to `.bak` dir and recreated; corrupt `hash-index.json` is renamed to `.bak` and reset
- Model ID and schema version are tracked in `vector-meta.json`; a mismatch on startup clears the hash index to force re-embedding
- Batch size is 500 texts per embedding API call

### discover-feature.ts — Process-wide wiring for semantic search

`buildDiscoverComponents` is a process-wide wiring function called once from
`buildAppContext` in `src/server/build.ts`. It instantiates the `EmbeddingClient` and
`VectorStore`, performs cold-start re-indexing when needed, and subscribes to
`syncEvents.on("sync:complete", …)` for incremental index updates. It returns the
`VectorStore` instance (or `null`), which `buildAppContext` then stashes onto
`AppContext.vectorStore`. **Tool registration is not wired here** —
`registerDiscoverTool(server, sessionCtx, vectorStore)` is called from `buildMcpServer`
once per server instance when `app.vectorStore !== null`.

A local `SyncEventsView` interface decouples this module from `SyncEngine`; it accepts
anything that exposes a typed `on`/`off` for `sync:complete` and `sync:error`.

| Export                    | Signature / Description                                                                                                                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildDiscoverComponents` | `(config, store, syncEvents, log?) => Promise<VectorStore \| null>` — builds + wires the semantic-search components; optional `log` is threaded as `log?.child({ component: "vector-store" })` into `VectorStore` |
| `SyncEventsView`          | `interface` describing the subset of `SyncEngine.events` (`on`/`off` for `sync:complete` and `sync:error`) used                                                                                                   |

**Invariants:**

- Returns `null` when `config.features.embeddings` is absent (semantic search disabled; `buildMcpServer` then skips `discover_recipes` registration)
- Cold-start re-index runs when vector store size is below 90% of recipe store size (catches stale/orphaned data)
- Vector index is invalidated when the embedding model or `EMBEDDING_SCHEMA_VERSION` changes between runs
- `sync:complete` handler indexes added/updated recipes and removes deleted ones
- Errors during sync-triggered indexing are caught and logged to stderr (never crash the server)
- Runs exactly once per process (during `buildAppContext`), not per session — the returned `VectorStore` is shared across all sessions via `AppContext.vectorStore`

## Dependencies

- **Uses:** `paprika/` (types — `SyncResult`), `cache/recipe-store.ts` (type-only), `utils/` (config types, xdg), `cockatiel`, `vectra`, `zod`
- **Used by:** `src/server/build.ts` (`buildAppContext` calls `buildDiscoverComponents`; `buildMcpServer` imports `VectorStore` type and `registerDiscoverTool` separately), `tools/discover.ts` (consumes `VectorStore`, `SemanticResult` types)
- **Boundary:** Must not import from `tools/` or `resources/` at runtime. Tool registration moved to `src/server/build.ts` in Phase 1 — `discover-feature.ts` no longer imports `registerDiscoverTool` (test files in this directory may still import from `tools/tool-test-utils.ts`; that is allowed because test code is outside the runtime boundary).
