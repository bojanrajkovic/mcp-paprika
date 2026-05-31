# Feature Implementations

Last verified: 2026-05-31

## Purpose

Orchestrates business logic by composing the Paprika API client and caching layer. Provides high-level operations that tools and resources consume.

## Contracts

### photography-errors.ts — Error hierarchy for photo-generation operations

Two-class hierarchy mirroring `embedding-errors.ts`, with ES2024 `ErrorOptions` cause chaining support. Local breaker-open events surface as `CircuitOpenError` from `../utils/errors.js` (shared with `PaprikaClient` and `EmbeddingClient`); import from there.

| Class                 | Extends            | Fields                                                  |
| --------------------- | ------------------ | ------------------------------------------------------- |
| `PhotographyError`    | `Error`            | (base class; also thrown on 200-with-no-image response) |
| `PhotographyAPIError` | `PhotographyError` | `readonly status: number`, `readonly endpoint: string`  |

### embedding-errors.ts — Error hierarchy for embedding operations

Two-class hierarchy with ES2024 `ErrorOptions` cause chaining support. Local breaker-open events surface as `CircuitOpenError` from `../utils/errors.js` (shared with `PaprikaClient`); import from there rather than from `embedding-errors.ts`.

| Class               | Extends          | Fields                                                 |
| ------------------- | ---------------- | ------------------------------------------------------ |
| `EmbeddingError`    | `Error`          | (base class for all embedding errors)                  |
| `EmbeddingAPIError` | `EmbeddingError` | `readonly status: number`, `readonly endpoint: string` |

### embeddings.ts — Embedding client and recipe-to-text conversion

`EmbeddingClient` is an HTTP client for OpenAI-compatible `/v1/embeddings` endpoints. Uses
`createResilientExecutor` from `../utils/resilience.js` (service `"embeddings"`) for resilience:
exponential-backoff retry (3 attempts, 500ms-10s) on transient HTTP errors (429, 500, 502, 503)
and a circuit breaker (opens after 5 consecutive failures, half-open after 30s). Validates
responses with Zod at the boundary. Per-instance resilience stack (no shared state between instances).

| Export                     | Signature / Description                                                                                               |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `EmbeddingClient`          | `constructor(config: Readonly<EmbeddingConfig>, log?: pino.Logger)` — resilient HTTP client; `log` defaults to silent |
| `.embed(text)`             | `Promise<Array<number>>` — embed a single text                                                                        |
| `.embedBatch(texts)`       | `Promise<Array<Array<number>>>` — embed multiple texts in one call                                                    |
| `.dimensions`              | `number` getter — throws `EmbeddingError` if no call made yet                                                         |
| `EMBEDDING_SCHEMA_VERSION` | `number` constant — bump when `recipeToEmbeddingText` format changes                                                  |
| `recipeToEmbeddingText`    | `(recipe, categoryNames) => string` — pure function, no I/O                                                           |

**Invariants:**

- `EmbeddingClient` throws (does not return `Result`) because it wraps cockatiel which uses exceptions for control flow
- `recipeToEmbeddingText` includes name, description, categories, ingredients, notes; excludes directions and nutritional info
- **IMPORTANT:** When changing `recipeToEmbeddingText` (adding/removing fields, restructuring format), bump `EMBEDDING_SCHEMA_VERSION` so existing users get a full re-index on next startup
- `BrokenCircuitError` from cockatiel is caught and re-thrown as `CircuitOpenError("embeddings", endpoint, { cause })` — no fabricated HTTP status; see `src/utils/errors.ts`

### photography.ts — Photo-generation client and prompt builder

`PhotographyClient` is an HTTP client for OpenRouter's chat-completions image-output API (`POST /chat/completions`). Uses `createResilientExecutor` from `../utils/resilience.js` (service `"photography"`) — the same retry + circuit-breaker stack as `EmbeddingClient`. The model is chosen per call (not at construction); only credentials are construction-time inputs.

| Export                 | Signature / Description                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PhotographyClient`    | `constructor(config: Readonly<ResolvedImageGenConfig>, log?: pino.Logger)` — resilient image-generation client; `log` defaults to silent                                              |
| `.generate(opts)`      | `Promise<GeneratedPhoto>` — generate an image; throws `PhotographyAPIError` on permanent HTTP error, `PhotographyError` on 200-with-no-image, `CircuitOpenError` when breaker is open |
| `PHOTO_MODELS`         | `readonly tuple` — curated model aliases: `["seedream", "nano-banana", "nano-banana-2", "gpt-image"]`; seeds the tool's `z.enum`                                                      |
| `PhotoModel`           | `type` — `(typeof PHOTO_MODELS)[number]`                                                                                                                                              |
| `DEFAULT_PHOTO_MODEL`  | `"seedream"` — default for `generate_photo`                                                                                                                                           |
| `PHOTO_ASPECT_RATIOS`  | `readonly tuple` — `["1:1", "4:3", "3:2", "16:9"]`                                                                                                                                    |
| `PhotoAspectRatio`     | `type` — `(typeof PHOTO_ASPECT_RATIOS)[number]`                                                                                                                                       |
| `ReferenceImage`       | `interface { data: Buffer, mimeType: string }` — reference image for image-to-image generation                                                                                        |
| `GeneratePhotoOptions` | `interface { prompt, model, aspectRatio?, referenceImage? }` — call options                                                                                                           |
| `GeneratedPhoto`       | `interface { bytes: Buffer, mimeType: string, costUsd: number \| null, servedModel: string }` — generation result                                                                     |
| `recipeToPhotoPrompt`  | `(recipe, categoryNames, style?) => string` — pure function; builds a photo prompt from name, description, categories, and optional style hint; excludes ingredients                  |

**Invariants:**

- `PhotographyClient` throws (does not return `Result`) — it wraps cockatiel which uses exceptions for control flow
- Image-only models (`seedream`) require `modalities: ["image"]`; other models require `["image", "text"]` — sending the wrong value yields a 404 from OpenRouter
- `image_size` is deliberately NOT sent — output size is model-inconsistent; `normalizePhoto({ maxFullEdge: 2048 })` normalizes downstream
- Response parsing expects `choices[].message.images[].image_url.url` as a base64 data-URI
- `recipeToPhotoPrompt` includes name, description, categories, and optional style; excludes ingredients (they produce ingredient-infographic output, not food photography)
- Logs `usage.cost` from the response at `info` level for cost tracking

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
- Hash map persisted via atomic write (write-to-tmp + rename) — same pattern `RecipeDiskCache` uses for `recipes/index.json` (see `../cache/disk/CLAUDE.md`)
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

| Export                    | Signature / Description                                                                                                                                                                                                                                                                                                                                              |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `buildDiscoverComponents` | `(config, store, categoryStore, syncEvents, log?) => Promise<VectorStore \| null>` — builds + wires the semantic-search components; `categoryStore` (3rd param) is used for cold-start + sync re-index category name resolution via `categoryStore.resolveNames(uids)`; optional `log` is threaded as `log?.child({ component: "vector-store" })` into `VectorStore` |
| `SyncEventsView`          | `interface` describing the subset of `SyncEngine.events` (`on`/`off` for `sync:complete` and `sync:error`) used                                                                                                                                                                                                                                                      |

**Invariants:**

- Returns `null` when `config.features.embeddings` is absent (semantic search disabled; `buildMcpServer` then skips `discover_recipes` registration)
- Cold-start re-index runs when vector store size is below 90% of recipe store size (catches stale/orphaned data)
- Vector index is invalidated when the embedding model or `EMBEDDING_SCHEMA_VERSION` changes between runs
- `sync:complete` handler indexes added/updated recipes and removes deleted ones
- Errors during sync-triggered indexing are caught and logged via a structured pino error record (never crash the server)
- Runs exactly once per process (during `buildAppContext`), not per session — the returned `VectorStore` is shared across all sessions via `AppContext.vectorStore`

## Logger integration

### VectorStore

Per-instance `log` child logger. Constructor takes optional `log?: Logger` (default: silent). Corruption recovery emits `warn` for corrupt Vectra index and corrupt `hash-index.json`. ENOENT and parse-failure paths in read operations emit `debug` or stay silent per the per-site classification in source comments.

### EmbeddingClient

Constructor takes optional `log?: Logger`. Per-attempt request lifecycle emits `debug` on start and success, `error` on non-retryable failure. Retry/breaker log events are wired inside `createResilientExecutor` (shared with `PhotographyClient`): `onRetry` → `warn`, `onGiveUp` → `error`, breaker open/reset/half-open → `warn`/`info`/`info`.

**Resilience (via `createResilientExecutor`):** `wrap(breakerPolicy, retryPolicy)` — breaker outer, retry inner. The breaker sees one execution per `embedBatch` call regardless of how many retries that call exhausted internally; `maxAttempts: 3` means 3 retries, so each failing call makes 4 total network attempts. Breaker opens after 5 consecutive failing calls (`ConsecutiveBreaker(5)`), half-opens after 30 s.

**Circuit open:** throws `CircuitOpenError("embeddings", endpoint, { cause: brokenCircuitError })` (imported from `../utils/errors.js`; shared with `PaprikaClient` and `PhotographyClient`) — no fabricated HTTP status. The error carries `service`, `endpoint`, and `cause: BrokenCircuitError` for structured access.

### buildDiscoverComponents

Takes optional `log?: Logger` from `buildAppContext`. Derives child loggers for `discover`, `vector-store`, and `embeddings` components. The `sync:complete` handler's error catch emits a structured pino `error` record `"vector index error during sync-driven re-index"` without propagating — preserving the sync loop's never-throws contract.

## Dependencies

- **Uses:** `paprika/` (types — `SyncResult`, `Recipe`), `cache/recipe-store.ts` (type-only), `cache/category-store.ts` (type-only), `utils/` (config types, `resolveImageGenConfig`, `createResilientExecutor`, xdg), `cockatiel`, `vectra`, `zod`
- **Used by:** `src/server/build.ts` (`buildAppContext` calls `buildDiscoverComponents` and constructs `PhotographyClient`; `buildMcpServer` imports `VectorStore`/`PhotographyClient` types and `registerDiscoverTool`/`registerGeneratePhotoTool` separately), `tools/discover.ts` (consumes `VectorStore`, `SemanticResult` types), `tools/photo-generate.ts` (consumes `PhotographyClient`, `recipeToPhotoPrompt`, `PHOTO_MODELS`, etc.)
- **Boundary:** Must not import from `tools/` or `resources/` at runtime. Tool registration moved to `src/server/build.ts` in Phase 1 — `discover-feature.ts` no longer imports `registerDiscoverTool` (test files in this directory may still import from `tools/tool-test-utils.ts`; that is allowed because test code is outside the runtime boundary).
