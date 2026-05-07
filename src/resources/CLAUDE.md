# MCP Resource Definitions

Last verified: 2026-05-07

## Purpose

Defines MCP resources that AI assistants can read. Resources expose data (e.g., recipe lists, categories) as structured content over the MCP protocol.

## Contracts

### Recipe Resources

**Function:** `registerRecipeResources(server: McpServer, ctx: ServerContext): void`

Registers the `paprika://recipe/{uid}` resource template with list and read callbacks:

- **List callback:** Returns all non-trashed recipes with `uri: "paprika://recipe/{uid}"`, `name: recipe.name`, and `mimeType: "text/markdown"` for each. Returns `{ resources: [] }` when store is empty.
- **Read callback:** Returns a recipe as markdown with a UID header (`**UID:** \`{uid}\``) prepended. Category UIDs are resolved to display names. Throws an error if the UID does not exist.

### Pantry Resources

**Function:** `registerPantryResources(server: McpServer, ctx: ServerContext): void`

Registers the `paprika://pantry/{uid}` resource template with list and read callbacks:

- **List callback:** Returns all pantry items with `uri: "paprika://pantry/{uid}"`, `name: item.ingredient`, and `mimeType: "text/markdown"` for each. Returns `{ resources: [] }` when store is empty.
- **Read callback:** Returns a pantry item as markdown formatted by `pantryItemToMarkdown()`. The markdown includes ingredient, UID, in-stock status, and optional fields (quantity, aisle, expiration date, purchase date, notes). Throws an error if the UID does not exist.

## Dependencies

- **Uses:** `tools/helpers.ts` (runtime import of `recipeToMarkdown`), `tools/pantry-helpers.ts` (runtime import of `pantryItemToMarkdown`), `types/server-context.ts` (ServerContext type), `paprika/types.ts` (type-only imports for `RecipeUid` and `PantryItemUid`)
- **Used by:** `index.ts` (MCP server registration)
- **Boundary:** May not import at runtime from `paprika/` or `cache/` directly (except `import type`). Runtime imports of helper files under `tools/` (e.g. `tools/helpers.js`, `tools/pantry-helpers.js`) are allowed.
