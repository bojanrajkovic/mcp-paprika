# MCP Resource Definitions

Last verified: 2026-06-02

Registers three read-only MCP resource templates (`paprika://recipe/{uid}`, `paprika://grocery-list/{uid}`, and `paprika://menu/{uid}`), each with a list callback (non-trashed/non-deleted entities mapped to `uri`/`name`/`text/markdown`) and a read callback (a metadata header followed by the entity rendered as markdown). The registration functions are `registerRecipeResources`, `registerGroceryListResources`, and `registerMenuResources`, wired into the server in `src/server/build.ts`; the exact header fields and render calls are read from the source, not transcribed here. The parts that aren't obvious from the signatures:

- **The recipe read header omits the UID; the other two carry it.** `recipeToMarkdown` (shared with `read_recipe`) already renders the UID in the body, so a `**UID:**` header line would duplicate it, and the recipe header starts at `**URI:**`. The grocery-list and menu bodies don't render their own UID, so those headers _do_ lead with `**UID:**`. The asymmetry is deliberate; don't "fix" it into uniformity.
- **Menu bodies render without child item UIDs.** The menu read passes `includeItemUids: false` to `menuToMarkdown`, matching the grocery-list convention of clean recipe-name lines. Exposing item UIDs is the tool surface's job (`read_menu`), not the resource's.
- **The runtime-import boundary sits at `tools/`.** These modules import the markdown helpers (`recipeToMarkdown`, `groceryListToMarkdown`, `menuToMarkdown`) from `tools/` as runtime values; everything from `paprika/` is `import type` only, and the stores are reached through `ctx`, never imported from `cache/`. Keep value imports pointed at `tools/`.
