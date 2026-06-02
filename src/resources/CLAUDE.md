# MCP Resource Definitions

Last verified: 2026-05-30

## Purpose

Defines MCP resources that AI assistants can read. Resources expose data (e.g., recipe lists, categories) as structured content over the MCP protocol.

## Contracts

### Recipe Resources

**Function:** `registerRecipeResources(server: McpServer, ctx: ServerContext): void`

Registers the `paprika://recipe/{uid}` resource template with list and read callbacks:

- **List callback:** Returns all non-trashed recipes with `uri: "paprika://recipe/{uid}"`, `name: recipe.name`, and `mimeType: "text/markdown"` for each. Returns `{ resources: [] }` when store is empty.
- **Read callback:** Returns a recipe as markdown with a metadata header prepended: `**URI:**` (always), `**Last synced:**` (when store has been synced), and `**Photo:**` (when recipe has an image URL). The UID is NOT in the header: `recipeToMarkdown` renders it in the body (shared with `read_recipe`), so the header would duplicate it. Category UIDs are resolved to display names. Throws an error if the UID does not exist.

### Grocery List Resources

**Function:** `registerGroceryListResources(server: McpServer, ctx: ServerContext): void`

Registers the `paprika://grocery-list/{uid}` resource template with list and read callbacks:

- **List callback:** Returns all non-deleted grocery lists from `ctx.groceryListStore.getAll()` mapped to `uri: "paprika://grocery-list/{uid}"`, `name: list.name`, and `mimeType: "text/markdown"` for each.
- **Read callback:** Takes the `uid` variable from the URI pattern. Looks up the list in `ctx.groceryListStore`. If not found, throws `Error("Grocery list not found: ${uid}")`. Otherwise builds a metadata header with `**UID:**` and `**URI:**` (always) plus `**Last synced:**` (when `ctx.groceryListStore.lastSyncedAt` is not null), fetches items via `ctx.groceryItemStore.getByListUid(uid)`, and renders the full body via `groceryListToMarkdown(list, items)`. Returns `{ contents: [{ uri, mimeType: "text/markdown", text }] }`.

### Menu Resources

**Function:** `registerMenuResources(server: McpServer, ctx: ServerContext): void`

Registers the `paprika://menu/{uid}` resource template with list and read callbacks:

- **List callback:** Returns all menus from `ctx.menuStore.getAll()` mapped to `uri: "paprika://menu/{uid}"`, `name: menu.name`, and `mimeType: "text/markdown"` for each.
- **Read callback:** Takes the `uid` variable from the URI pattern. Looks up the menu in `ctx.menuStore`. If not found, throws `Error("Menu not found: ${uid}")`. Otherwise builds a metadata header with `**UID:**` and `**URI:**` (always) plus `**Last synced:**` (when `ctx.menuStore.lastSyncedAt` is not null), fetches items via `ctx.menuItemStore.getByMenuUid(uid)`, and renders the full body via `menuToMarkdown(menu, items, ctx.mealTypeStore.getAll(), { includeItemUids: false })` (clean recipe-name lines without child UIDs, matching the grocery-list resource convention). Returns `{ contents: [{ uri, mimeType: "text/markdown", text }] }`.

## Dependencies

- **Uses:** `tools/helpers.ts` (runtime import of `recipeToMarkdown`), `tools/grocery-helpers.ts` (runtime import of `groceryListToMarkdown`), `tools/menu-helpers.ts` (runtime import of `menuToMarkdown`), `types/server-context.ts` (ServerContext type), `paprika/types.ts` (type-only imports for `RecipeUid`, `GroceryListUid`, `MenuUid`)
- **Used by:** `src/server/build.ts` (MCP server registration via `registerRecipeResources`, `registerGroceryListResources`, and `registerMenuResources`)
- **Boundary:** May not import at runtime from `paprika/` or `cache/` directly (except `import type`). Runtime imports of helper files under `tools/` (e.g. `tools/helpers.js`, `tools/grocery-helpers.js`, `tools/menu-helpers.js`) are allowed.
