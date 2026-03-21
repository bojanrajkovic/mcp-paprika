# Feature Implementations

Last verified: 2026-03-20

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

| Export                  | Signature / Description                                                  |
| ----------------------- | ------------------------------------------------------------------------ |
| `EmbeddingClient`       | `constructor(config: Readonly<EmbeddingConfig>)` — resilient HTTP client |
| `.embed(text)`          | `Promise<Array<number>>` — embed a single text                           |
| `.embedBatch(texts)`    | `Promise<Array<Array<number>>>` — embed multiple texts in one call       |
| `.dimensions`           | `number` getter — throws `EmbeddingError` if no call made yet            |
| `recipeToEmbeddingText` | `(recipe, categoryNames) => string` — pure function, no I/O              |

**Invariants:**

- `EmbeddingClient` throws (does not return `Result`) because it wraps cockatiel which uses exceptions for control flow
- `recipeToEmbeddingText` includes name, description, categories, ingredients, notes; excludes directions and nutritional info
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

| Export            | Signature / Description                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `contentHash`     | `(text: string) => string` — SHA-256 hex digest for change detection                        |
| `SemanticResult`  | `type { uid, score, recipeName }` — single search result                                    |
| `IndexingResult`  | `type { indexed, skipped, total }` — batch indexing summary                                 |
| `VectorStore`     | `constructor(cacheDir: string, embedder: EmbeddingClient)` — vector store instance          |
| `.init()`         | `Promise<void>` — creates directory, Vectra index, loads hash map; recovers from corruption |
| `.indexRecipes()` | `Promise<IndexingResult>` — batch index with change detection, batches of 500               |
| `.indexRecipe()`  | `Promise<IndexingResult>` — convenience single-recipe wrapper                               |
| `.search()`       | `Promise<ReadonlyArray<SemanticResult>>` — semantic search, default topK=10                 |
| `.removeRecipe()` | `Promise<void>` — remove recipe from index and hash map                                     |
| `.size`           | `number` getter — count of indexed recipes (via hash map)                                   |

**Invariants:**

- `VectorStore` throws (does not return `Result`) because it wraps Vectra and `EmbeddingClient` which use exceptions
- Content hash uses SHA-256 of `recipeToEmbeddingText()` output; unchanged recipes are skipped during indexing
- Hash map persisted via atomic write (write-to-tmp + rename) following `DiskCache` pattern
- Corruption recovery: corrupt Vectra index is backed up to `.bak` dir and recreated; corrupt `hash-index.json` is renamed to `.bak` and reset
- Batch size is 500 texts per embedding API call

### discover-feature.ts — Startup wiring for semantic search

`setupDiscoverFeature` is a wiring function called from `index.ts` at server startup. It
creates the `EmbeddingClient` and `VectorStore`, registers the `discover_recipes` tool,
performs cold-start indexing if needed, and subscribes to `sync:complete` events for
incremental index updates. A no-op if `config.features.embeddings` is not configured.

| Export                 | Signature / Description                                                                |
| ---------------------- | -------------------------------------------------------------------------------------- |
| `setupDiscoverFeature` | `(server, ctx, sync, config) => Promise<void>` — wires semantic search into the server |

**Invariants:**

- No-op when `config.features.embeddings` is absent (semantic search remains disabled)
- Cold-start indexing runs only when vector index is empty but recipe store has data
- `sync:complete` handler indexes added/updated recipes and removes deleted ones
- Errors during sync-triggered indexing are caught and logged to stderr (never crash the server)

## Dependencies

- **Uses:** `paprika/` (types), `utils/` (config types, xdg), `tools/` (discover tool registration), `cockatiel`, `vectra`, `zod`
- **Used by:** `index.ts` (server startup), `tools/`, `resources/`
- **Boundary:** Core building blocks (embeddings, vector-store, errors) must not import from `tools/` or `resources/`. Wiring functions (`discover-feature.ts`) may import tool registration functions.
