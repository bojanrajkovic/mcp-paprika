# MCP Tool Definitions

Last verified: 2026-06-02

## Purpose

MCP tools the model invokes on its own (read, query, mutate) across every Paprika entity family. Each file exports a `register*Tool(server, ctx)` that closes over the per-session `SessionContext` and calls `server.registerTool(...)`; tools needing extra services (vector store, photography client) take them as trailing parameters.

## Key References

- **Registry (canonical):** `src/server/build.ts` — `buildMcpServer` lists every `register*Tool` call. That file, not this one, is the source of truth for _what is registered_ and the two feature gates (`discover_recipes` iff `vectorStore !== null`, `generate_photo` iff `photographyClient !== null`).
- **Per-tool reference:** `docs/tools/README.md` covers every tool's parameters, behavior, and examples (generated from source by `scripts/generate-tool-reference.ts`). The Zod `inputSchema` in each tool file is the authoritative param contract.
- **Surface classification:** `docs/adr/0004-tool-vs-resource-classification.md` — the Content/Data/Reference rule that decides whether an entity gets tools, a resource, or both, and _why a `read_X` tool is not redundant with the `paprika://X/{uid}` resource_ (different invocation paths: model vs. user attach).
- **Store / sync / cache model:** `docs/architecture.md`; per-store Content/Data/Reference roles in `src/server/CLAUDE.md`; the pending-writes ordering contract in `src/cache/CLAUDE.md`.

## Sharp edges

These are cross-cutting invariants that span the tool family; no grep reproduces the reasoning.

- **Recipe-link XOR freeform is a `z.union` of `.strict()` objects, not a `.refine()` on a flat object.** Meals, menu items, and photo `source` all dispatch on property presence so that `{recipe_uid, name}` (or two sources at once) matches _no_ variant and is rejected at the Zod boundary. The reason is UX, not style: Paprika.app dispatches a linked meal's display name off `recipe_uid` and would never render a stored custom `name` there, so a stored name on a linked record is invisible dead data. Rejecting it structurally surfaces the constraint to the LLM instead of silently shipping data nothing reads. Same rationale drives the runtime guard that rejects a rename of an already-recipe-linked meal (demote first). MCP needs a flat top-level shape, so where the union is a payload (`update_meal`'s `update`, `upload_photo`'s `source`) it sits one level down.

- **Soft-delete is an idempotent tombstone, uniformly.** Every `delete_*` writes a tombstone and a retried call returns "already deleted" from the store's tombstone set without re-POSTing; callers (and flaky networks) can retry safely. `delete_recipe` moves to Paprika trash (reversible in-app); `empty_trash` is the only hard delete and guards on `inTrash` so a single call can never destroy a live recipe. `empty_trash` deliberately fetches authoritative `inTrash` from Paprika rather than trusting the local store, because the store lags app-side trash actions by up to a sync cycle; trusting it would wrongly refuse a recipe the user trashed in the app.

- **Writes commit through a per-entity helper chokepoint; do not hand-roll the sequence in a tool.** Each family's `commit*` helper (in `*-helpers.ts`) is the single place that orders: `markPending{Upsert,Delete}` (sync, FIRST) → cache put/remove → flush → store set/delete → [notify] → `notifySync`. The pending-write mark MUST precede any cache I/O so an in-flight sync cycle that observes the cache mid-commit still sees the flag and skips reconciling our UID (see `src/cache/CLAUDE.md`); cache I/O is wrapped so a failure clears the mark instead of shielding the UID until TTL. Tools never call `notifySync` separately; the helper already does.

- **`resourceListChanged()` fires only for Content entities.** Recipes, grocery lists, and menus have an MCP resource surface, so their commit helpers emit it (a container's child-item change fires it too; items are inlined in the parent resource). Data/Reference families (pantry, meals, categories, photos) emit nothing; there is no resource to invalidate. A photo attach is also silent: the recipe resource renders `photoUrl`, which a photo write doesn't change.

- **Vector-index maintenance lives inside the recipe/category commit helpers, before `notifySync`.** A tool-written recipe's UID is pending, so the sync re-index path filters it out; without `maintainRecipeIndex` (no-op when `vectorStore === null`) a tool-created recipe is never embedded and a tool-edited one keeps its stale vector. A category _rename_ re-embeds its assigned recipes (the display name is in their embedding text, and the recipe sync can't see this local write). Running it before `notifySync` means a notify failure can't skip it. Best-effort: an index failure is logged at `warn`, never thrown; the Paprika write already succeeded.

- **Tool output is action-oriented markdown; it is NOT the resource rendering.** Tools render clean markdown via the family's `*ToMarkdown` helper (the model already holds the UID in its call chain, so tool output omits the metadata header that the resource prepends for the user). Keep the two paths consistent via the shared helper; see ADR-0004 for why both exist.

- **`order_flag` is per-DATE for meals (and menu-wide for menu items), per the wire captures.** Two same-date meals of different types post as 0 and 1; two same-type meals on different dates both post as 0 (`docs/wire-captures/meals.har.json`). Batch adds assign via the shared `makeMealOrderFlagAssigner`; a single-meal date move re-sequences to `getMaxOrderFlagOn(destDate) + 1` only when the date actually changes (a type change keeps the position). Menu items sequence menu-wide instead, not reset per day (`docs/wire-captures/menus.har.json`). `order_flag` is never caller-supplied.

- **Photo `source` deliberately has no `file_path`.** A server-side path read is an LFI/SSRF risk and meaningless for the remote HTTP transport. The three accepted sources are `{ url }` (server downloads), `{ generation_token }` (a single-use `gen_` token from a `generate_photo` preview; the token is consumed synchronously before any `await`, so two racing attaches can't both spend it, and it's validated against the recipe it was generated for), and `{ image_base64 }` (programmatic/test).

- **Boundary: tool handlers reach data only through `ctx`.** Access state via `ctx.store` / `ctx.client` / the typed stores on `SessionContext`; never import `paprika/` or `cache/` _runtime_ modules. Runtime imports of Zod schemas — UID brands from `../ids.js`, entity schemas from the per-entity `../<entity>/types.js` (input validation) — and anything in `utils/` are fine; `import type` from `paprika/` and `cache/` is fine. Branded `XxxUidSchema` input fields are type-only at runtime, so a parsed `args.uid` flows into `ctx.store.get(...)` with no re-parse/cast at the lookup; remaining `XxxUidSchema.parse(...)` calls are for _generated_ or _server-derived_ UIDs, not tool inputs.
