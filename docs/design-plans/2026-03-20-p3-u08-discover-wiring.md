# P3-U08 Discover Wiring Design

## Summary

P3-U08 wires the semantic recipe discovery feature — built across earlier Phase 3 units — into the running server. The three previously completed components (`EmbeddingClient`, `VectorStore`, and `registerDiscoverTool`) each work in isolation; this unit connects them to the application lifecycle so that the `discover_recipes` MCP tool is available at runtime and the vector index stays up to date as recipes sync from Paprika.

The wiring is encapsulated in a new `setupDiscoverFeature()` function in `src/features/discover-feature.ts`, which `src/index.ts` calls at the existing Phase 3 extension point with a single `await`. The function checks whether embeddings are configured and returns early if not, so the feature is fully opt-in and the Phase 2 tools are unaffected in either case. When enabled, it initializes the embedding client and vector store, registers the discover tool, and subscribes to the sync engine's `sync:complete` event so that every completed sync cycle updates the vector index with added, changed, or removed recipes. The sync subscription is error-isolated: failures in vector indexing are caught and logged but never allowed to disrupt the sync engine itself.

## Definition of Done

Modify `src/index.ts` to conditionally initialize semantic search when `config.features.embeddings` is configured: create an `EmbeddingClient` and `VectorStore`, call `vectorStore.init()`, register `discover_recipes` via `registerDiscoverTool`, and subscribe to `sync:complete` events to keep the vector index updated after each sync cycle. The sync event handler is error-isolated (try/catch so vector errors cannot disrupt sync). `sync.ts` is not modified. All existing Phase 2 tools continue working regardless of Phase 3 configuration. Photo tool wiring is deferred (P3-U02/U05 not yet implemented).

## Acceptance Criteria

### p3-u08-discover-wiring.AC1: Feature gating

- **p3-u08-discover-wiring.AC1.1 Success:** When `config.features.embeddings` is configured, `discover_recipes` tool is registered and available
- **p3-u08-discover-wiring.AC1.2 Success:** When `config.features.embeddings` is absent, `discover_recipes` tool is not registered
- **p3-u08-discover-wiring.AC1.3 Success:** Startup logs "Semantic search: enabled" to stderr when embeddings configured
- **p3-u08-discover-wiring.AC1.4 Success:** Startup logs "Semantic search: disabled" to stderr when embeddings not configured

### p3-u08-discover-wiring.AC2: Component initialization

- **p3-u08-discover-wiring.AC2.1 Success:** `EmbeddingClient` is created with the `config.features.embeddings` object
- **p3-u08-discover-wiring.AC2.2 Success:** `VectorStore` is created with `getCacheDir()` and the `EmbeddingClient` instance
- **p3-u08-discover-wiring.AC2.3 Success:** `vectorStore.init()` is awaited before `registerDiscoverTool` is called
- **p3-u08-discover-wiring.AC2.4 Success:** `registerDiscoverTool` is called with `(server, ctx, vectorStore)`

### p3-u08-discover-wiring.AC3: Sync event subscription

- **p3-u08-discover-wiring.AC3.1 Success:** `sync.events.on("sync:complete", ...)` is subscribed before `server.connect(transport)`
- **p3-u08-discover-wiring.AC3.2 Success:** When `sync:complete` fires with added/updated recipes, `vectorStore.indexRecipes()` is called with the changed recipes and a category resolver
- **p3-u08-discover-wiring.AC3.3 Success:** When `sync:complete` fires with `removedUids`, `vectorStore.removeRecipe()` is called for each uid
- **p3-u08-discover-wiring.AC3.4 Edge:** When `sync:complete` fires with no changes (empty added, updated, removedUids), no indexing or removal calls are made

### p3-u08-discover-wiring.AC4: Error isolation

- **p3-u08-discover-wiring.AC4.1 Success:** An exception thrown by `vectorStore.indexRecipes()` in the sync handler is caught and logged to stderr
- **p3-u08-discover-wiring.AC4.2 Success:** An exception thrown by `vectorStore.removeRecipe()` in the sync handler is caught and logged to stderr
- **p3-u08-discover-wiring.AC4.3 Success:** Vector index errors do not propagate to SyncEngine or affect subsequent sync cycles

### p3-u08-discover-wiring.AC5: Non-interference

- **p3-u08-discover-wiring.AC5.1 Success:** `src/paprika/sync.ts` is not modified by this implementation
- **p3-u08-discover-wiring.AC5.2 Success:** All Phase 2 tools continue working correctly when embeddings config is present
- **p3-u08-discover-wiring.AC5.3 Success:** All Phase 2 tools continue working correctly when embeddings config is absent

## Glossary

- **EmbeddingClient**: A cockatiel-wrapped HTTP client that calls an OpenAI-compatible embeddings API to convert recipe text into numeric vectors. Implemented in P3-U03.
- **VectorStore**: A persistent local index (backed by Vectra) that stores recipe embedding vectors and supports nearest-neighbor lookup. Persists to disk across restarts. Implemented in P3-U04.
- **`discover_recipes` tool**: The MCP tool that accepts a natural-language query and returns semantically similar recipes. Implemented in P3-U06.
- **`setupDiscoverFeature()`**: The feature module function introduced by this unit. Encapsulates feature gate, client/store initialization, tool registration, and sync subscription.
- **Feature gate**: A conditional check (`config.features.embeddings`) that enables Phase 3 behavior only when embeddings configuration is provided.
- **Feature module pattern**: A convention where conditional feature wiring is extracted into a dedicated module with a single exported setup function, rather than inlined in `main()`.
- **`sync:complete` event**: A mitt event emitted by `SyncEngine` after each sync cycle, carrying `SyncResult` with added, updated, and removed recipes.
- **`SyncResult`**: The payload of the `sync:complete` event: `{ added, updated, removedUids }`.
- **mitt**: A tiny TypeScript event emitter library. `SyncEngine` exposes a read-only view for external subscribers.
- **Vectra / `LocalIndex`**: The local vector similarity search library used by `VectorStore`.
- **cockatiel**: A resilience library (retry, circuit-breaker) used to wrap the embedding HTTP client.
- **Error isolation**: Wrapping the sync event handler in try/catch so vector indexing failures cannot propagate into `SyncEngine`.
- **Fire-and-forget**: mitt fires event handlers synchronously but does not await async handlers. Vector indexing runs concurrently with the next sync interval.

## Architecture

Feature module pattern: `src/features/discover-feature.ts` exports a single `setupDiscoverFeature()` function that encapsulates the full discover/embeddings lifecycle. The entry point (`src/index.ts`) calls this function at the Phase 3 extension point (line 95), reducing the wiring to a single `await` call.

`setupDiscoverFeature()` takes four dependencies — `McpServer`, `ServerContext`, `SyncEngine`, and `PaprikaConfig` — and handles all conditional logic internally:

1. **Feature gate**: checks `config.features.embeddings` — returns early with a "disabled" log if absent
2. **Client creation**: `EmbeddingClient(config.features.embeddings)` — cockatiel-wrapped HTTP client for OpenAI-compatible embeddings API
3. **Store initialization**: `VectorStore(getCacheDir(), embedder)` then `await vectorStore.init()` — creates/opens Vectra index and loads hash map
4. **Tool registration**: `registerDiscoverTool(server, ctx, vectorStore)` — registers the `discover_recipes` MCP tool
5. **Sync subscription**: `sync.events.on("sync:complete", handler)` — subscribes to mitt events to keep vector index updated
6. **Startup log**: `process.stderr.write(...)` with `[mcp-paprika]` prefix indicating enabled/disabled status

### Sync Event Handler

The event handler receives `SyncResult` with `added`, `updated`, and `removedUids`:

- Merges `added` and `updated` into a `changed` array
- If `changed.length > 0`, calls `vectorStore.indexRecipes(changed, resolveCats)` where `resolveCats` delegates to `ctx.store.resolveCategories()`
- For each uid in `removedUids`, calls `vectorStore.removeRecipe(uid)`
- Skips all work when nothing changed (no-op optimization)
- Entire handler body wrapped in try/catch — errors logged to stderr, never propagated into SyncEngine

Error isolation is critical: mitt fires handlers synchronously. An unhandled async rejection in the handler would propagate to `syncOnce()`, potentially breaking the sync cycle. The try/catch ensures vector index failures are observable but do not affect sync resilience.

### No Initial Indexing Required

VectorStore persists its index to disk (Vectra `LocalIndex` + `hash-index.json`). On the first run with an empty index, the first `sync:complete` event fires with all recipes in `added`, which triggers `indexRecipes()` — the mitt event pattern handles initial population naturally.

## Existing Patterns

### Phase 2 Tool Registration (inline pattern)

Phase 2 tools are registered inline in `main()`:

```typescript
registerSearchTool(server, ctx);
registerReadTool(server, ctx);
// ... 6 more
```

This design diverges by extracting wiring into a feature module rather than inlining. The divergence is justified because:

- Phase 3 features are conditional (gated on config), unlike Phase 2 tools which are always registered
- Phase 3 wiring involves multi-step initialization (create client → create store → init → register → subscribe), not a single function call
- Feature modules are independently testable

### SyncEngine Event Subscription (Design Decision D1)

The mitt event pattern was established in the implementation plan's design decisions. `SyncEngine` exposes `events` as `Pick<SyncEventEmitter, "on" | "off">` — a read-only view of the emitter. Phase 3 subscribes externally; `sync.ts` is never modified.

### Stderr Logging

The project uses `process.stderr.write()` for diagnostic output (MCP stdio transport occupies stdout). Existing log lines in `src/index.ts` use the `[mcp-paprika]` prefix. This design follows that convention.

## Implementation Phases

<!-- START_PHASE_1 -->

### Phase 1: Feature Module and Entry Point Integration

**Goal:** Create the `setupDiscoverFeature()` function, integrate it into `src/index.ts`, and verify with unit and integration tests.

**Components:**

- `src/features/discover-feature.ts` (create) — exports `setupDiscoverFeature(server, ctx, sync, config)` with conditional init, tool registration, and sync event subscription
- `src/index.ts` (modify) — add Phase 3 imports and call `await setupDiscoverFeature(server, ctx, sync, config)` at the extension point
- `src/features/discover-feature.test.ts` (create) — unit tests with mocked EmbeddingClient, VectorStore, and registerDiscoverTool
- `src/features/discover-feature.test.integration.ts` (create) — integration test with real EmbeddingClient + VectorStore (requires Ollama)

**Dependencies:** P3-U04 (VectorStore), P3-U06 (registerDiscoverTool), P3-U03 (EmbeddingClient) — all complete

**Done when:** `pnpm typecheck` passes, `pnpm test` passes (all existing + new tests), `pnpm lint` passes, `sync.ts` is unmodified

<!-- END_PHASE_1 -->

## Additional Considerations

**Photo tool placeholder:** When P3-U02 (photography) and P3-U05 (photo tool) are implemented, a companion `setupPhotoFeature()` can follow the same feature module pattern. The entry point would gain a second `await setupPhotoFeature(...)` call. This is why the feature module pattern was chosen over inline wiring.

**Async event handler caveat:** mitt does not await async handlers. The sync event handler is `async` but mitt fires it synchronously (fire-and-forget). This means `indexRecipes()` runs concurrently with the next sync interval. In practice this is fine — sync intervals are minutes apart, indexing takes seconds. If a second sync fires before indexing completes, VectorStore's hash-based change detection ensures idempotent behavior.
