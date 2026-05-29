# Server Composition Root

Last verified: 2026-05-28

## Purpose

Process-wide composition root. Owns the authoritative context types (`AppContext`, `SessionContext`), the `Notifier` abstraction that decouples mutation code from "the server," and the `buildAppContext` / `buildMcpServer` builders that draw the line between process-wide and per-session state.

This split exists so the same business logic (tools, resources, sync engine) can run unchanged under stdio (one server per process) and HTTP (N concurrent sessions per process).

## Files

- `app-context.ts` — `AppContext` and `SessionContext` interfaces
- `notifier.ts` — `Notifier` interface, `singleServerNotifier`, `broadcastNotifier`, `LoggingMessageParams`, `SessionSnapshot`
- `build.ts` — `buildAppContext`, `buildMcpServer`

## Contracts

### AppContext

Process-wide, heavyweight, shared state. Built once per process by `buildAppContext`.

| Field                    | Type                     | Description                                                                                                                                                                                                                                |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `client`                 | `PaprikaClient`          | Authenticated Paprika HTTP client                                                                                                                                                                                                          |
| `cache`                  | `DiskCacheRoot`          | On-disk persistence layer (per-entity subcaches under `cache.recipes`, `cache.pantry`, `cache.aisles`, `cache.groceryLists`, `cache.groceryItems`, `cache.groceryIngredients`, `cache.oauthClients`, etc.). See `../cache/disk/CLAUDE.md`. |
| `store`                  | `RecipeStore`            | In-memory recipe query layer                                                                                                                                                                                                               |
| `pantryStore`            | `PantryStore`            | In-memory pantry query layer                                                                                                                                                                                                               |
| `aisleStore`             | `AisleStore`             | In-memory aisle query layer; `hasSynced` after first sync; used by `ensureAisle` in pantry write tools for aisle resolution and auto-creation                                                                                              |
| `groceryListStore`       | `GroceryListStore`       | In-memory grocery list query layer; EntityStore subclass with tombstones, `findByName`, `lastSyncedAt`                                                                                                                                     |
| `groceryItemStore`       | `GroceryItemStore`       | In-memory grocery item query layer; EntityStore subclass with tombstones, `getByListUid`, `getPurchasedByList`                                                                                                                             |
| `groceryIngredientStore` | `GroceryIngredientStore` | In-memory grocery ingredient lookup (plain class, not EntityStore; keyed by lowercase name; no pending-writes)                                                                                                                             |
| `mealStore`              | `MealStore`              | In-memory meal query layer (TombstoneEntityStore subclass; `getByRecipeUid`, `lastCookedAt`, `getInDateRange`; `isIngredient` entries excluded from queries)                                                                               |
| `mealTypeStore`          | `MealTypeStore`          | In-memory meal type query layer (EntityStore subclass; `resolveByName` for case-insensitive lookup, reference catalog like AisleStore)                                                                                                     |
| `vectorStore`            | `VectorStore \| null`    | Semantic-search index; `null` when embeddings are not configured                                                                                                                                                                           |
| `notifier`               | `Notifier`               | Notification surface — decouples callers from any one `McpServer` instance                                                                                                                                                                 |
| `auth`                   | `AuthContext \| null`    | OAuth 2.1 runtime state; `null` in stdio mode (no auth required)                                                                                                                                                                           |
| `log`                    | `Logger`                 | Process-wide pino root from `src/utils/log.ts`. Children created via `parent.child({component: "..."})` flow to component-scoped sites. `warn+` records fan out to MCP clients automatically.                                              |

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

### Deferred-getter pattern and bootstrap order

The transport entry points construct components in this order:

1. **Build the notifier** with a getter closure: `let server; const notifier = singleServerNotifier(() => server)`. The getter returns `undefined` at this point — that is fine; notifier methods are only called at runtime, well after step 3.
2. **Build the logger** via `createLogger({transport, notifier, ...config.logging})`. The logger is constructed before `AppContext` so that startup records emitted inside `buildAppContext` ("mcp-paprika starting", authentication, cache hydration) flow through the structured logger rather than the legacy shim. Pre-McpServer log calls that fan out through the notifier silently no-op because the notifier's getter still returns `undefined` — this is safe by design.
3. **Build the `AppContext`** with that notifier and logger: `const { app, sync } = await buildAppContext(config, notifier)`. `SyncEngine` is constructed inside here and captures the notifier — it never reads `app.server` because there isn't one yet (and `AppContext` has no `server` field by design).
4. **Build the `McpServer`** (stdio) or session map (HTTP) from the `AppContext` and assign into the closure: `server = buildMcpServer(app)`. From this point forward, notifier method calls resolve to a real server.
5. **`server.connect` / `app.listen`** — begin accepting protocol traffic.

If anyone restructures `src/index.ts` or `src/transport/`, preserve this ordering — collapsing it (e.g. trying to construct the server before the `AppContext`) makes the cycle unresolvable.

### Logging behavior at startup

**Startup info record is level-gated.** `buildAppContext` emits `log.info({transport}, "mcp-paprika starting")` as its first act. With the default `MCP_LOG_LEVEL=info`, this record appears in pod logs, stderr, and any configured log file. If an operator sets `MCP_LOG_LEVEL=warn` (or higher), the record is silently suppressed — this is the intentional behavior change vs. the legacy unconditional stderr shim. Operators who need a startup signal at warn+ should keep `MCP_LOG_LEVEL=info` (the default) or rely on process-supervisor logs.

**SIGINT/SIGTERM handler uses `process.stderr.write` directly.** The signal handler in `src/index.ts` does not use the structured logger because the logger may be torn down or never built at signal time (e.g., early startup failure before `createLogger` returns). This is the one intentional production-code exception to the "no `process.stderr.write`" rule.

### buildAppContext

```typescript
buildAppContext(config: PaprikaConfig, notifier: Notifier): Promise<{ app: AppContext; sync: SyncEngine }>
```

Process-wide builder. Authenticates the Paprika client, hydrates `DiskCache`, `RecipeStore`, `PantryStore`, `AisleStore`, `GroceryListStore`, `GroceryItemStore`, and `GroceryIngredientStore` from disk, constructs `SyncEngine`, **wires the `sync:complete` → `resourceListChanged` subscriber**, **runs the initial `sync.syncOnce()`**, then calls `buildDiscoverComponents` (which subscribes the vector store to `sync.events` for incremental re-indexing). Returns the assembled `AppContext` plus the `SyncEngine`; the caller starts the background loop with `sync.start()` if `config.sync.enabled`.

Reads `config.sync.pendingWriteTtl` and threads it as `pendingWriteTtlMs` into `RecipeStore`, `PantryStore`, `AisleStore`, `GroceryListStore`, and `GroceryItemStore`. `GroceryIngredientStore` takes no options (no pending-writes). When `config.sync.enabled === false`, `pendingWriteTtlMs = 0` is passed to disable the feature entirely.

**Construction order is load-bearing:**

1. Authenticate (this is where bad credentials fast-fail — `syncOnce()` swallows everything).
2. Hydrate caches and stores from disk: recipes (RecipeStore), pantry (PantryStore), aisles (AisleStore, filtered `!deleted`), grocery lists (GroceryListStore), grocery items (GroceryItemStore), grocery ingredients (GroceryIngredientStore, filtered `!deleted`), meals (MealStore, filtered `!deleted`), meal types (MealTypeStore). Categories are not pre-hydrated — the cache deliberately has no `getAllCategories()`.
   2.5. **`await buildAuthContext(config, cache)`** — returns `null` for stdio; for HTTP, fetches the OIDC discovery document and assembles all OAuth stores and the provider. Throws on discovery failure (fail-fast: no value running HTTP mode if auth is broken).
3. Construct `SyncEngine` against a placeholder `AppContext` whose `vectorStore: null`. Safe because `SyncEngine` never reads `vectorStore`. The `auth` value from step 2.5 is passed here.
   3.5. **Wire the `sync:complete` → `resourceListChanged` subscriber** immediately after `new SyncEngine()`. This subscriber is permanent (never `off()`'d) and calls `notifier.resourceListChanged()` when `changeType` is `"recipes"`, `"grocery-lists"`, or `"grocery-items"` AND any of `changes.added`, `changes.updated`, or `changes.removedUids` is non-empty. Pantry (`"pantry"`) is excluded — pantry items have no MCP resource surface. The engine emits four events per cycle; the subscriber narrows by `changeType`.
4. **`await sync.syncOnce()`.** Categories live only in `RecipeStore` (populated by `setCategories()`, which is called only from inside `syncOnce()`). Cold-start vector indexing in `buildDiscoverComponents` resolves category names per recipe; if it runs before the first sync, embeddings get computed with empty categories and stay that way until a recipe mutation re-embeds. On warm restarts with unchanged remote hashes, the post-build sync emits nothing, so the `sync:complete` subscription never gets the chance to fix it.
5. Build discover components against the now-hydrated store. The "real" `AppContext` with the populated `vectorStore` and `auth` is what the caller receives.

### buildMcpServer

```typescript
buildMcpServer(app: AppContext): McpServer
```

Per-session builder. Constructs a fresh `McpServer`, wraps `app` into a `SessionContext` by adding the server reference, and registers all 29 tools plus the recipe and grocery-list resource families. `registerDiscoverTool` is registered only when `app.vectorStore !== null` (semantic search is opt-in via config).

**Called once for stdio; called once per session for HTTP** (Phase 3). Tool registration is pure — each `registerXxxTool` only closes over the per-session `SessionContext` and calls `server.registerTool(...)`. There is no module-level mutable state, so registering the same tool name on N independent server instances is safe.

## Invariants

- `AppContext` has no `server` field — anything that needs to send a notification goes through `ctx.notifier` instead. This is the load-bearing invariant that makes process-wide state independent of session count.
- Notifier methods never throw.
- `buildAppContext` is called exactly once per process; `buildMcpServer` is called once per session.
- The discover tool is registered iff `app.vectorStore !== null`.
- `app.auth !== null` iff `config.transport === "http"`. Use-sites check `app.auth === null` to detect stdio mode (mirrors the `vectorStore` optional-feature pattern).

## Dependencies

- **Uses:** `@modelcontextprotocol/sdk` (`McpServer`, `LoggingMessageNotification`), `../paprika/` (`PaprikaClient`, `SyncEngine`), `../cache/` (`RecipeStore`, `PantryStore`, `AisleStore`, `GroceryListStore`, `GroceryItemStore`, `GroceryIngredientStore`) and `../cache/disk/` (`DiskCacheRoot`), `../features/` (`VectorStore`, `buildDiscoverComponents`), `../tools/` (all `register*Tool` functions), `../resources/` (`registerRecipeResources`, `registerGroceryListResources`), `../utils/` (`PaprikaConfig`, `getCacheDir`), `../auth/` (`buildAuthContext`)
- **Used by:** `src/index.ts` (stdio entry point); `src/transport/http.ts` calls `buildAppContext` once and `buildMcpServer` per session
- **Boundary:** This is the composition root — it is allowed to import from every other src directory. Other src directories must not import from `src/server/` back into themselves except via `import type` (e.g., `src/types/server-context.ts` and `src/paprika/sync.ts` import `AppContext`/`SessionContext` types from here).
