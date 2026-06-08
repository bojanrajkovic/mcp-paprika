# Server Bootstrap & Transport Seams

## Purpose

The non-kernel pieces of the composition path: the transport-blind `Notifier` seam, the pre-kernel bootstrap (`buildInfraBase` + `buildBrandedServer`), the background sync loop, and the cross-entity index-event seam. Module construction, the sync driver, and boot-phase ordering now live in the **kernel** (`../kernel/CLAUDE.md`); this directory is what wraps it for the two transports.

## Key References

- `../kernel/CLAUDE.md` + `docs/adr/0009-domain-isolated-tool-modules-kernel.md` — the kernel; module construction, the sync driver, and boot-phase ordering live there.
- `docs/adr/0001-two-transports-and-composition-root.md` — the two-transport split, the `Notifier` seam, and the notifier/server bootstrap cycle (`ServerRef`) this still implements.
- Source is the catalog: the four files here are small and their doc-comments carry the per-piece rationale — read them rather than an export inventory.

## Sharp edges

### Nothing process-wide carries a server

The load-bearing invariant that makes process-wide state independent of session count: under HTTP there is no single "the server" (there are N, or zero during bootstrap). The kernel's `Infra`/`BootCtx` therefore have **no `server`** — only the per-session `DomainCtx` adds one. Anything that pushes a notification goes through `infra.notifier`. Don't reintroduce a server field on a process-wide type; it bakes in the stdio one-server assumption HTTP can't honor.

### Notifier methods never throw

Both implementations swallow transport failures: `singleServerNotifier` silently (stdio), `broadcastNotifier` per-server (HTTP). Required because the kernel's `syncOnce` is contractually never-throws — a notification failure must not turn a successful sync into a reported failure. `broadcastNotifier` snapshots the session set into an array before iterating (so adding/removing a session mid-broadcast can't invalidate the iterator) and wraps each `sendLoggingMessage` in an async IIFE so a synchronous throw becomes a rejected promise `Promise.allSettled` absorbs.

### `ServerRef` breaks the notifier/server bootstrap cycle (stdio)

The notifier needs the server, the server is registered after the kernel is built, and the kernel's initial sync may fire `resourceListChanged` before any server exists. stdio resolves this with a `{ get, set }` `ServerRef` whose `get()` returns `undefined` until `set()` runs post-build, so an early notify silently no-ops. HTTP has no single server and uses `broadcastNotifier` over a live sessions snapshot instead. See ADR-0001.

### `buildInfraBase` is the credential fast-fail, outside the kernel

`client.authenticate()` errs here on bad credentials and `unwrapAtBoot` aborts boot (ADR-0014 form #5); the kernel's `syncOnce` swallows everything, so a credential error would otherwise be invisible (#158). Keep authentication in `buildInfraBase`, not in a module. The transports assemble the full `Infra` from this base plus `notifier`/`config`/`indexEvents`/`generatedImageStore`, then call `buildKernel`.

### `notifyFromResults` fans out resource notifications from the loop, not the engine

`buildKernel`'s `syncOnce` returns the `AnySyncResult[]` of a completed cycle; the interval loop passes them to `notifyFromResults`, which fires `resourceListChanged` only for change types with a resource surface (recipes, grocery-lists, grocery-items, menus, menu-items) and only when the change set is non-empty. The initial sync at build time discards its results (no session exists yet); the loop's immediate first cycle re-syncs and notifies.

### The index-event seam (`IndexEventEmitter`) crosses a non-edge

Recipe writes and the recipe/category reconciles emit `recipe-changed`/`recipe-removed`/`category-changed` on `infra.indexEvents`; discover's `index` boot hook subscribes. It rides `infra` rather than a `dependsOn` edge because discover's contract is empty by design — there is no dependency edge into it.

### Startup logging is level-gated; SIGINT/SIGTERM writes raw stderr

`buildInfraBase` logs `mcp-paprika starting` and `buildKernel` logs `running initial sync` at `info`; `MCP_LOG_LEVEL=warn`+ silently suppresses them. The signal handler in `src/index.ts` bypasses the structured logger (it may not be built yet, or already torn down) — one of the two sanctioned `process.stderr.write` exceptions, because stdout carries the stdio wire.

### Feature tools register unconditionally

The kernel registers `discover_recipes`/`generate_recipe_photo` unconditionally; they no-op when their client is null. The feature gate lives inside the handler, not at registration. See ADR-0009 §5.
