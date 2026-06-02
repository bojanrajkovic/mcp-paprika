# Server Composition Root

Last verified: 2026-06-01

## Purpose

Process-wide composition root. Owns the authoritative context types (`AppContext`, `SessionContext`), the `Notifier` abstraction that decouples mutation code from "the server," and the `buildAppContext` / `buildMcpServer` builders that draw the line between process-wide and per-session state. This split lets the same tools/resources/sync engine run unchanged under stdio (one server per process) and HTTP (N concurrent sessions per process).

## Key References

- `docs/adr/0001-two-transports-and-composition-root.md` — the AppContext/SessionContext split, the Notifier seam, the bootstrap-order cycle, and the rejected single-transport / DI-container alternatives.
- `src/server/app-context.ts` — the exhaustive, canonical field list for `AppContext` and `SessionContext`. Treat that file as the source of truth; do not re-enumerate fields here.
- `src/server/notifier.ts` — `Notifier`, `singleServerNotifier`, `broadcastNotifier`.
- `../cache/disk/CLAUDE.md` — the disk subcaches that `AppContext.cache` exposes.
- ADR-0004 (entity store roles) — the Content / Data / Reference taxonomy referenced below.

## Context shape (conceptual)

`AppContext` is the heavyweight process-wide state, built once. It holds the Paprika client, the disk cache, the optional `vectorStore`/`photographyClient`, the ephemeral `generatedImageStore`, the logger, the optional `auth` runtime, and the `Notifier`. Its in-memory query stores group by their ADR-0004 role:

- **Content stores** (parent entities with their own resource surface) — recipe, grocery-list, menu.
- **Data stores** (child entities owned by a Content parent) — grocery-item, menu-item, meal, photo. Meals and photos are recipe-children with no standalone resource.
- **Reference stores** (case-insensitive lookup catalogs) — category, aisle, meal-type, grocery-ingredient.

`SessionContext` is `AppContext` plus the one session's `McpServer` — the only thing handlers receive. `src/types/server-context.ts` re-exports it as `ServerContext` for backward compatibility.

## Sharp edges

### `AppContext` has no `server` field — by design

This is the load-bearing invariant that makes process-wide state independent of session count. Under HTTP there is no single "the server" (there are N, or zero during bootstrap), so nothing process-wide is allowed to reach one. Anything that needs to push a notification goes through `ctx.notifier`. Do not add a `server` field to `AppContext` to "simplify" a call site — that reintroduces the stdio one-server assumption HTTP cannot honor.

### Notifier methods never throw

Both implementations swallow transport failures: `singleServerNotifier` silently (stdio), `broadcastNotifier` per-server (HTTP). This is required because `SyncEngine.syncOnce()` is contractually never-throws — a notification failure must not turn a successful sync into a reported failure. `broadcastNotifier` materializes the session snapshot into an array before iterating so adding/removing a session mid-broadcast (especially during the async `loggingMessage` fan-out) cannot invalidate the iterator, and wraps each `sendLoggingMessage` in an async IIFE so a _synchronous_ throw becomes a rejected promise that `Promise.allSettled` can absorb rather than escaping into `syncOnce()`.

### Deferred-getter bootstrap order is a real cycle — do not collapse it

`AppContext` needs the notifier; in stdio mode the notifier needs the server; the server is built _from_ the `AppContext`. The cycle is broken by constructing the notifier first around a getter closure (`() => server`) that returns `undefined` until the server is assigned. The pinned order is: (1) build notifier with the getter; (2) build the logger (so startup records flow through structured logging, not a shim); (3) `buildAppContext` (constructs `SyncEngine`, which captures the notifier and never reads `app.server` because there is none); (4) `buildMcpServer` and assign into the closure; (5) `connect`/`listen`. Pre-server notifier/log calls fan out to a getter returning `undefined` and silently no-op — safe _only_ because the order holds. Trying to build the server before the context makes the cycle unresolvable.

### `buildAppContext` construction order is load-bearing

1. **Authenticate first** — this is the real fast-fail for bad credentials (`authenticate()` throws; `syncOnce()` swallows everything, so a credential error would otherwise be invisible).
2. Hydrate the disk cache and every store. Reference/Content/Data stores hydrate from disk on warm restart but start empty on a true cold start.
3. **`buildAuthContext`** returns `null` for stdio; for HTTP it fetches the OIDC discovery document and assembles the OAuth stores/provider, throwing on failure (no value running a public HTTP endpoint with broken auth).
4. Construct `SyncEngine` against a placeholder `AppContext` whose `vectorStore: null` — safe because `SyncEngine` never reads `vectorStore`.
5. **Wire the `sync:complete` → `resourceListChanged` subscriber immediately after `new SyncEngine()`**, not inside the engine (keeps the engine decoupled from the notifier decision). It fires only for `changeType` in {recipes, grocery-lists, grocery-items, menus, menu-items} when any of added/updated/removedUids is non-empty. Pantry is deliberately excluded — pantry items have no MCP resource surface. Both menu events fire because menu items are inlined into the `paprika://menu/{uid}` resource.
6. **Run the initial `sync.syncOnce()` BEFORE building discover components.** Cold-start vector indexing calls `categoryStore.resolveNames(uids)` per recipe; if it ran before the first sync populated the (cold-start-empty) `CategoryStore`, embeddings would be computed with empty category names and stay stale until a recipe mutation forces a re-embed — and on a warm restart with unchanged remote hashes the post-build sync emits nothing, so the `sync:complete` subscriber never gets a chance to fix it. `syncOnce()` never throws, so awaiting it cannot block startup.

### Startup logging is level-gated

`buildAppContext`'s first act is `log.info({transport}, "mcp-paprika starting")`. At the default `info` level it lands in pod logs/stderr/file; setting `MCP_LOG_LEVEL=warn`+ silently suppresses it. Operators who need a startup signal must keep `info` or rely on the process supervisor.

### SIGINT/SIGTERM handler writes directly to stderr

The signal handler in `src/index.ts` bypasses the structured logger because at signal time the logger may not be built yet (early startup failure) or may already be torn down. This is one of the few sanctioned exceptions to the "no direct `process.stderr.write`" rule (which exists because stdout carries the stdio wire format).

### Feature-gated tool registration

`buildMcpServer` registers the unconditional tool/resource families on a fresh `McpServer` for every session. Registration is pure — each `register*` only closes over the per-session `SessionContext`; there is no module-level mutable state, so registering the same tool name on N independent servers is safe. Two tools are conditional and share the same opt-in pattern: the discover tool registers **iff `app.vectorStore !== null`**, and `generate_photo` registers **iff `app.photographyClient !== null`**.

### Invariants

- `app.auth !== null` **iff** `config.transport === "http"`. Use-sites check `app.auth === null` to detect stdio mode (mirrors the `vectorStore` optional-feature pattern).
- `buildAppContext` runs exactly once per process; `buildMcpServer` runs once per session.
- This directory is the composition root: it may import from every other `src/` directory. Other directories must not import from `src/server/` except via `import type` (e.g. `src/types/server-context.ts`, `src/paprika/sync.ts` pull the context types).
