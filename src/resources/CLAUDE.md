# MCP Resource Definitions

Last verified: 2026-03-17

## Purpose

Defines MCP resources that AI assistants can read. Resources expose data (e.g., recipe lists, categories) as structured content over the MCP protocol.

## Contracts

### Recipe Resources

**Function:** `registerRecipeResources(server: McpServer, ctx: ServerContext): void`

Registers the `paprika://recipe/{uid}` resource template with list and read callbacks:

- **List callback:** Returns all non-trashed recipes with `uri: "paprika://recipe/{uid}"`, `name: recipe.name`, and `mimeType: "text/markdown"` for each. Returns `{ resources: [] }` when store is empty.
- **Read callback:** Returns a recipe as markdown with a UID header (`**UID:** \`{uid}\``) prepended. Category UIDs are resolved to display names. Throws an error if the UID does not exist.

## Dependencies

- **Uses:** `tools/helpers.ts` (runtime import of `recipeToMarkdown`), `types/server-context.ts` (ServerContext type), `paprika/types.ts` (type-only imports for RecipeUid)
- **Used by:** `index.ts` (MCP server registration)
- **Boundary:** May not import at runtime from `paprika/` or `cache/` directly (except `import type`). Runtime imports of `tools/helpers.js` are allowed.
