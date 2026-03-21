# Architecture

mcp-paprika is an MCP server that bridges the Paprika recipe manager cloud API with local caching, background sync, and optional semantic search. It communicates with MCP clients over stdio.

## Startup sequence

The server boots in a fixed order. Each step depends on the previous one completing:

1. **Load config** — merges env vars, `.env`, and `config.json` (see [configuration](configuration.md))
2. **Authenticate** — `PaprikaClient` POSTs email/password to Paprika's v1 login endpoint, stores the JWT
3. **Initialize disk cache** — `DiskCache` creates directories and loads `index.json` (recipe UID → content hash map)
4. **Hydrate recipe store** — reads all cached recipes from disk into the in-memory `RecipeStore`
5. **Create MCP server** — constructs the `McpServer` instance
6. **Register tools** — 9 core tools (search, filter, CRUD, categories, list)
7. **Register resources** — recipe resources at `paprika://recipe/{uid}`
8. **Initial sync** — `SyncEngine.syncOnce()` fetches changes from Paprika cloud
9. **Start background sync** — polling loop at the configured interval (if enabled)
10. **Wire semantic search** — `setupDiscoverFeature()` conditionally initializes embeddings, vector store, and the `discover_recipes` tool
11. **Connect transport** — `StdioServerTransport` starts accepting MCP messages

Steps 1-9 happen before the server accepts any client messages. The semantic search wiring (step 10) happens after the initial sync so the vector store can detect whether it needs to do a cold-start index.

## Dual-layer cache

Recipes are cached in two layers:

### In-memory: RecipeStore

`RecipeStore` is a `Map<RecipeUid, Recipe>` with query methods bolted on. It's the source of truth for all tool operations during a session.

- **Search** — tiered scoring: exact match > starts-with > substring
- **Filter by ingredient** — `"all"` (AND) or `"any"` (OR) mode
- **Filter by time** — parses duration strings, sorts by total time
- **Category resolution** — `Map<CategoryUid, Category>` for UID → display name lookups
- **Exclusions** — trashed recipes are excluded from all query methods (direct UID lookup still works)

### On-disk: DiskCache

`DiskCache` persists recipes as individual JSON files in the cache directory. It handles the startup cold-start case: if the server restarts, recipes are loaded from disk into the `RecipeStore` before the first sync, so tools are immediately usable.

Structure:

```
~/.cache/mcp-paprika/
├── index.json              # UID → content hash map
├── recipes/
│   ├── {uid}.json          # Individual recipe files
│   └── ...
└── categories/
    ├── {uid}.json
    └── ...
```

Writes are buffered in memory and flushed atomically (write to temp file, then rename). The `index.json` tracks content hashes so the sync engine can detect what changed remotely without re-downloading everything.

**Corruption recovery:** if `index.json` or any recipe file has invalid JSON, the cache logs a warning and resets to empty. The next sync repopulates everything.

## Sync engine

`SyncEngine` keeps the local cache in sync with Paprika's cloud. It runs an initial sync on startup, then optionally polls in the background.

### Sync cycle

Each cycle does two things:

**Recipe sync (diff-and-fetch):**

1. Fetch the lightweight recipe entry list from Paprika (UIDs + content hashes only)
2. Diff against the local `index.json` to find added, changed, and removed recipes
3. Fetch full recipe data only for added/changed recipes
4. Write to disk cache and update the in-memory store
5. Remove deleted recipes from both layers

**Category sync (replace-all):**

1. Fetch all categories from Paprika
2. Replace the store's category map and write to disk

After both complete, the cache is flushed and an MCP `resourceListChanged` notification is sent so clients know to refresh.

### Events

The sync engine emits two events via a [mitt](https://github.com/developit/mitt) emitter:

- `sync:complete` — fired after every successful cycle with a `SyncResult` containing added, updated, and removed recipe lists
- `sync:error` — fired when a cycle fails (the error is logged but never thrown)

The semantic search feature subscribes to `sync:complete` to incrementally update the vector index.

## Semantic search

Semantic search is an optional feature that adds the `discover_recipes` tool. It's enabled when all three embedding config values are set (see [configuration](configuration.md)).

### Components

**EmbeddingClient** — HTTP client for any OpenAI-compatible `/v1/embeddings` endpoint. Supports single and batch embedding. See [embedding providers](embedding-providers.md) for setup.

**VectorStore** — wraps [Vectra](https://github.com/Stevenic/vectra) for local vector storage. Recipes are converted to embedding text (name, description, categories, ingredients, notes — excluding directions and nutritional info), embedded, and stored with SHA-256 content hashes for change detection.

**Feature wiring** — `setupDiscoverFeature()` ties everything together:

1. Creates the `EmbeddingClient` and `VectorStore`
2. Registers the `discover_recipes` tool
3. Handles cold-start indexing (if the vector index is empty but the recipe store has data)
4. Subscribes to `sync:complete` to index new/updated recipes and remove deleted ones

### Change detection

The vector store maintains a hash map (recipe UID → SHA-256 of embedding text). During indexing, unchanged recipes are skipped. This means re-syncing 500 recipes where only 3 changed results in only 3 embedding API calls.

### Error isolation

Embedding and vector store errors in the sync handler are caught and logged to stderr. They never propagate to the sync engine or crash the server. If Ollama goes down mid-sync, you'll see a log message but the server keeps running, and the next sync cycle will retry.

## Resilience

Both the Paprika API client and the embedding client use [cockatiel](https://github.com/connor4312/cockatiel) for resilience:

### Retry

Exponential backoff with jitter: 500ms initial delay, 10s max delay, 3 attempts. Triggered by transient HTTP errors: 429 (rate limit), 500, 502, 503.

### Circuit breaker

Opens after 5 consecutive failures. Half-open after 30 seconds (allows one probe request). If the probe succeeds, the circuit closes. If it fails, the circuit stays open for another 30 seconds.

### Bulkhead

Recipe fetches during sync are limited to 5 concurrent requests to avoid overwhelming the Paprika API.

### Auth retry

If a Paprika API call returns 401 (expired token), the client re-authenticates once and retries. If the retry also fails, the error propagates.

## Error handling

The codebase uses two error strategies depending on context:

**Core business logic** uses [neverthrow](https://github.com/supermacro/neverthrow) `Result<T, E>` types. Config loading, duration parsing, and other pure operations return `Result` and are composed with `.andThen()`, `.map()`, and `.match()`. No exceptions.

**Infrastructure code** (Paprika client, embedding client, vector store) throws exceptions because it wraps libraries (cockatiel, Vectra) that use exceptions for control flow. These are caught at system boundaries — the sync engine's try/catch, the discover feature's error isolation handler, and the tool handlers.

## Project structure

```
src/
├── index.ts           # Entry point: config → auth → cache → server → sync → transport
├── paprika/           # Paprika API client and sync engine
├── cache/             # DiskCache (persistent) and RecipeStore (in-memory)
├── tools/             # MCP tool definitions (one file per tool or tool group)
├── resources/         # MCP resource definitions
├── features/          # Feature implementations (embeddings, vector store, discover wiring)
├── types/             # Shared type definitions
└── utils/             # Cross-cutting utilities (config, XDG paths, duration parsing)
```
