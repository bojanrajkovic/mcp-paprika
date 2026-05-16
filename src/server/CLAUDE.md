# Server Composition Root

Last verified: 2026-05-15

## Purpose

Process-wide composition root. Owns the authoritative context types (`AppContext`, `SessionContext`), the `Notifier` abstraction that decouples mutation code from "the server," and the `buildAppContext` / `buildMcpServer` builders that draw the line between process-wide and per-session state.

This split exists so the same business logic (tools, resources, sync engine) can run unchanged under stdio (one server per process) and HTTP (N concurrent sessions per process). Phase 1 introduced the split; the HTTP transport itself lands in Phase 3 and does not exist yet — do not reference `src/transport/` or any HTTP code from these files until then.

## Files

- `app-context.ts` — `AppContext` and `SessionContext` interfaces
- `notifier.ts` — `Notifier` interface, `singleServerNotifier`, `broadcastNotifier`, `LoggingMessageParams`, `SessionSnapshot`
- `build.ts` — `buildAppContext`, `buildMcpServer`

## Contracts

### AppContext

Process-wide, heavyweight, shared state. Built once per process by `buildAppContext`.

| Field         | Type                  | Description                                                                |
| ------------- | --------------------- | -------------------------------------------------------------------------- |
| `client`      | `PaprikaClient`       | Authenticated Paprika HTTP client                                          |
| `cache`       | `DiskCache`           | On-disk persistence layer                                                  |
| `store`       | `RecipeStore`         | In-memory recipe query layer                                               |
| `pantryStore` | `PantryStore`         | In-memory pantry query layer                                               |
| `vectorStore` | `VectorStore \| null` | Semantic-search index; `null` when embeddings are not configured           |
| `notifier`    | `Notifier`            | Notification surface — decouples callers from any one `McpServer` instance |

All fields are `readonly`. Notably **no `server`** — `AppContext` is intentionally agnostic to how many MCP sessions exist.

### SessionContext

```typescript
interface SessionContext extends AppContext {
  readonly server: McpServer;
}
```

Per-session view. `SessionContext` is what every tool and resource handler receives. For stdio there is exactly one `SessionContext` for the process lifetime; for HTTP there is one per active session.

`src/types/server-context.ts` re-exports `SessionContext` as `ServerContext` for backward compatibility with existing handler signatures.

### Notifier

```typescript
interface Notifier {
  resourceListChanged(): void;
  loggingMessage(params: LoggingMessageParams): Promise<void>;
}
```

Abstraction over MCP server notifications. Every code path that historically called `server.sendResourceListChanged()` or `server.sendLoggingMessage()` now goes through `ctx.notifier.*` instead, so the same call site works whether there is one underlying server (stdio) or many (HTTP).

**Two implementations:**

- `singleServerNotifier(serverOrGetter)` — stdio mode. Accepts either an `McpServer` directly OR a `() => McpServer | undefined` getter (see "Deferred-getter pattern" below). Swallows transport errors silently so a notification failure cannot break the sync loop or violate `SyncEngine.syncOnce()`'s never-throws contract.
- `broadcastNotifier(snapshot)` — HTTP mode. Takes a `SessionSnapshot = () => Iterable<McpServer>` and materializes a snapshot before each broadcast. `resourceListChanged()` iterates synchronously, catching per-server failures so one bad session cannot stop the broadcast. `loggingMessage()` fans out with `Promise.allSettled`.

**Invariants:**

- Notifier methods never throw. Transport failures are swallowed (stdio) or contained per-server (HTTP).
- `broadcastNotifier` materializes the snapshot into an array before iteration so that adding or removing a session mid-broadcast (especially during the async `loggingMessage` path) cannot cause iterator invalidation.

### Deferred-getter pattern (stdio chicken-and-egg)

The stdio entry point has a strict three-step construction order:

1. **Build the notifier first** with a getter closure: `let server; const notifier = singleServerNotifier(() => server)`. The getter returns `undefined` at this point — that is fine; notifier methods are only called at runtime, well after step 3.
2. **Build the `AppContext`** with that notifier: `const { app, sync } = await buildAppContext(config, notifier)`. `SyncEngine` is constructed inside here and captures the notifier — it never reads `app.server` because there isn't one yet (and `AppContext` has no `server` field by design).
3. **Build the `McpServer`** from the `AppContext` and assign it into the closure: `server = buildMcpServer(app)`. From this point forward, notifier method calls resolve to a real server.

If anyone restructures `src/index.ts`, preserve this ordering — collapsing it (e.g. trying to construct the server before the `AppContext`) makes the cycle unresolvable.

### buildAppContext

```typescript
buildAppContext(config: PaprikaConfig, notifier: Notifier): Promise<{ app: AppContext; sync: SyncEngine }>
```

Process-wide builder. Authenticates the Paprika client, hydrates `DiskCache`, `RecipeStore`, and `PantryStore` from disk, constructs `SyncEngine`, then calls `buildDiscoverComponents` (subscribes the vector store to `sync.events`). Returns the assembled `AppContext` plus the `SyncEngine` so the entry point can drive the initial sync and start the background loop.

**Construction order matters:** `SyncEngine` is built BEFORE the vector store so the vector store can subscribe to `sync.events`. `SyncEngine` is given a placeholder `AppContext` whose `vectorStore: null`; this is safe because `SyncEngine` never reads `vectorStore`. The "real" `AppContext` with the populated `vectorStore` is what the caller receives.

### buildMcpServer

```typescript
buildMcpServer(app: AppContext): McpServer
```

Per-session builder. Constructs a fresh `McpServer`, wraps `app` into a `SessionContext` by adding the server reference, and registers all 14 tools plus the recipe and pantry resource families. `registerDiscoverTool` is registered only when `app.vectorStore !== null` (semantic search is opt-in via config).

**Called once for stdio; called once per session for HTTP** (Phase 3). Tool registration is pure — each `registerXxxTool` only closes over the per-session `SessionContext` and calls `server.registerTool(...)`. There is no module-level mutable state, so registering the same tool name on N independent server instances is safe.

## Invariants

- `AppContext` has no `server` field — anything that needs to send a notification goes through `ctx.notifier` instead. This is the load-bearing invariant that makes process-wide state independent of session count.
- Notifier methods never throw.
- `buildAppContext` is called exactly once per process; `buildMcpServer` is called once per session.
- The discover tool is registered iff `app.vectorStore !== null`.

## Dependencies

- **Uses:** `@modelcontextprotocol/sdk` (`McpServer`, `LoggingMessageNotification`), `../paprika/` (`PaprikaClient`, `SyncEngine`), `../cache/` (`DiskCache`, `RecipeStore`, `PantryStore`), `../features/` (`VectorStore`, `buildDiscoverComponents`), `../tools/` (all `register*Tool` functions), `../resources/` (`registerRecipeResources`, `registerPantryResources`), `../utils/` (`PaprikaConfig`, `getCacheDir`)
- **Used by:** `src/index.ts` (stdio entry point); Phase 3 HTTP transport will also call `buildAppContext` once and `buildMcpServer` per session
- **Boundary:** This is the composition root — it is allowed to import from every other src directory. Other src directories must not import from `src/server/` back into themselves except via `import type` (e.g., `src/types/server-context.ts` and `src/paprika/sync.ts` import `AppContext`/`SessionContext` types from here).
