# Server Composition Root

Last verified: 2026-06-02

## Purpose

Process-wide composition root. Owns the authoritative context types (`AppContext`, `SessionContext`), the `Notifier` abstraction that decouples mutation code from "the server," and the `buildAppContext` / `buildMcpServer` builders that draw the line between process-wide and per-session state. This split lets the same tools, resources, and sync engine run unchanged under stdio (one server per process) and HTTP (N concurrent sessions per process).

## Key References

- `docs/adr/0001-two-transports-and-composition-root.md` — the AppContext/SessionContext split, the Notifier seam, the bootstrap-order cycle, and the rejected single-transport alternative.
- `docs/adr/0005-composition-modules-and-identifiers.md` — the composition-root shape (phase-typed builder; a DI container _deferred_ behind a written trigger, not rejected), the per-entity module structure, and foreign-key branding via `src/ids.ts`.
- `src/server/app-context.ts` — the exhaustive, canonical field list for `AppContext` and `SessionContext`. Treat that file as the source of truth; do not re-enumerate fields here.
- `src/server/notifier.ts` — `Notifier`, `singleServerNotifier`, `broadcastNotifier`.
- `../cache/CLAUDE.md` (Persistence section) — the disk subcaches that `AppContext.cache` exposes.
- ADR-0004 (entity store roles) — the Content / Data / Reference taxonomy referenced below.

## Context shape (conceptual)

`AppContext` is the heavyweight process-wide state, built once. It holds the Paprika client, the disk cache, the optional `vectorStore`/`photographyClient`, the ephemeral `generatedImageStore`, the logger, the optional `auth` runtime, and the `Notifier`. Its in-memory query stores group by their ADR-0004 role:

- **Content stores** (parent entities with their own resource surface) — recipe, grocery-list, menu.
- **Data stores** (child entities owned by a Content parent) — grocery-item, menu-item, meal, photo. Meals and photos are recipe-children with no standalone resource.
- **Reference stores** (case-insensitive lookup catalogs) — category, aisle, meal-type, grocery-ingredient.

`SessionContext` is `AppContext` plus the one session's `McpServer`: it is the only thing handlers receive. `src/types/server-context.ts` re-exports it as `ServerContext` for backward compatibility.

## Sharp edges

### `AppContext` has no `server` field — by design

This is the load-bearing invariant that makes process-wide state independent of session count. Under HTTP there is no single "the server" (there are N, or zero during bootstrap), so nothing process-wide is allowed to reach one. Anything that needs to push a notification goes through `ctx.notifier`. Do not add a `server` field to `AppContext` to "simplify" a call site: that reintroduces the stdio one-server assumption HTTP cannot honor.

### Notifier methods never throw

Both implementations swallow transport failures: `singleServerNotifier` silently (stdio), `broadcastNotifier` per-server (HTTP). This is required because `SyncEngine.syncOnce()` is contractually never-throws; a notification failure must not turn a successful sync into a reported failure. `broadcastNotifier` materializes the session snapshot into an array before iterating so adding/removing a session mid-broadcast (especially during the async `loggingMessage` fan-out) cannot invalidate the iterator, and wraps each `sendLoggingMessage` in an async IIFE so a _synchronous_ throw becomes a rejected promise that `Promise.allSettled` can absorb rather than escaping into `syncOnce()`.

### `ServerRef` breaks the notifier/server bootstrap cycle

The stdio bootstrap order is pinned: `createServerRef()` → `singleServerNotifier(ref.get)` → `buildAppContext` → `buildMcpServer` + `ref.set(server)` → `connect`. `ServerRef` is a `{ get, set }` holder whose `get()` returns `undefined` until `set()` runs after the server is built, so any notifier call during construction (e.g. the initial sync's `resourceListChanged`) silently no-ops — safe _only_ because that order holds. HTTP has no single server, so it uses `broadcastNotifier` over a live sessions snapshot instead. The cycle this resolves — and why a `ServerRef` rather than a `server` field on `AppContext` — is ADR-0001 and ADR-0005.

### `buildAppContext` construction order is load-bearing

It runs as seven typed phases (`build.ts`), each consuming the previous phase's result type so the order is a compile-time guarantee, not a convention — e.g. `buildFeatures` requires the `Indexed` that only `runInitialSync` produces:

1. **`authenticate`** — build the logger, then authenticate the Paprika client. The real fast-fail for bad credentials (`client.authenticate()` throws; `syncOnce()` swallows everything, so a credential error would otherwise be invisible).
2. **`hydrate`** — open the disk cache and hydrate every store (Reference/Content/Data stores hydrate from disk on warm restart, start empty on cold start), then assemble the `core` `SyncDeps` slice (client, cache, the 12 stores, log) — built **once** and reused for both the `SyncEngine` and the final `AppContext`.
3. **`buildAuth`** — `null` for stdio; for HTTP it fetches the OIDC discovery document and assembles the OAuth stores/provider, throwing on failure (no value in serving a public endpoint with broken auth). Runs after hydration; it reads only `config`/`cache`/`log`, none of which hydration mutates.
4. **`wireSync`** — `new SyncEngine(core, …)` (the engine takes the narrow `SyncDeps` slice, never an `AppContext`), then wire the `sync:complete` → `resourceListChanged` subscriber here, not inside the engine (keeps the engine decoupled from the notifier decision). It fires only for `changeType` in {recipes, grocery-lists, grocery-items, menus, menu-items} when any of added/updated/removedUids is non-empty. Pantry is excluded (no MCP resource surface); both menu events fire because menu items inline into the `paprika://menu/{uid}` resource.
5. **`runInitialSync`** — run the initial `sync.syncOnce()` **before** building discover components. Cold-start vector indexing calls `categoryStore.resolveNames(uids)` per recipe; if it ran before the first sync populated the (cold-start-empty) `CategoryStore`, embeddings would bake in empty category names and stay stale until a recipe mutation. On a warm restart with unchanged remote hashes the post-build sync emits nothing, so the subscriber never gets a chance to fix it. `syncOnce()` never throws, so awaiting it cannot block startup.
6. **`buildFeatures`** — build the optional vector store (discover) and photography client; gated behind the `Indexed` result so it cannot precede the initial sync.
7. **`assemble`** — spread `core` plus `generatedImageStore`/`vectorStore`/`photographyClient`/`notifier`/`auth` into the one `AppContext`.

### Startup logging is level-gated

`buildAppContext`'s first act is `log.info({transport}, "mcp-paprika starting")`. At the default `info` level it lands in pod logs/stderr/file; setting `MCP_LOG_LEVEL=warn` or higher silently suppresses it. Operators who need a startup signal must keep `info` or rely on the process supervisor.

### SIGINT/SIGTERM handler writes directly to stderr

The signal handler in `src/index.ts` bypasses the structured logger because at signal time the logger may not be built yet (early startup failure) or may already be torn down. This is one of the few sanctioned exceptions to the "no direct `process.stderr.write`" rule, which exists because stdout carries the stdio wire format.

### Feature-gated tool registration

`buildMcpServer` registers the unconditional tool/resource families on a fresh `McpServer` for every session. Registration is pure: each `register*` only closes over the per-session `SessionContext`; there is no module-level mutable state, so registering the same tool name on N independent servers is safe. Two tools are conditional and share the same opt-in pattern: the discover tool registers **iff `app.vectorStore !== null`**, and `generate_photo` registers **iff `app.photographyClient !== null`**.

### Invariants

- `app.auth !== null` **iff** `config.transport === "http"`. Use-sites check `app.auth === null` to detect stdio mode (mirrors the `vectorStore` optional-feature pattern).
- `buildAppContext` runs exactly once per process; `buildMcpServer` runs once per session.
