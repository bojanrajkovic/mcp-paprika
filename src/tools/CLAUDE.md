# MCP Tool Definitions

Last verified: 2026-03-13

Purpose: Defines MCP tools that AI assistants can invoke. Each tool file exports a `register*` function that takes `(server: McpServer, ctx: ServerContext)` and calls `server.registerTool()`.

## Registered Tools

| Tool                   | File            | Description                                           |
| ---------------------- | --------------- | ----------------------------------------------------- |
| `search_recipes`       | `search.ts`     | Full-text search by name, ingredients, or description |
| `filter_by_ingredient` | `filter.ts`     | Filter recipes by ingredient (all/any mode)           |
| `filter_by_time`       | `filter.ts`     | Filter recipes by prep/cook/total time constraints    |
| `list_categories`      | `categories.ts` | List all categories with recipe counts                |

## Registration Pattern

Every tool file exports a single registration function. All tool logic accesses data through `ctx.store` (the `RecipeStore` on `ServerContext`), never by importing `paprika/` or `cache/` directly at runtime.

```typescript
import { coldStartGuard, textResult } from "./helpers.js";

export function registerMyTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "tool_name",
    {
      description: "...",
      inputSchema: {
        /* zod */
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async () => {
          /* store is ready */ return textResult("result");
        },
        (guard) => guard,
      );
    },
  );
}
```

## Shared Helpers (`helpers.ts`)

Utilities imported by all tool handlers from `./helpers.js`.

- **`textResult(text)`** -- Wraps a string in the MCP `CallToolResult` envelope.
- **`coldStartGuard(ctx)`** -- Returns `Ok<void>` when store is synced, `Err<CallToolResult>` when empty. Always use `.match()` to handle both branches.
- **`recipeToMarkdown(recipe, categoryNames)`** -- Renders a full recipe as markdown. Resolve categories via `ctx.store.resolveCategories()` before calling. Omits empty optional fields.

## Testing (`tool-test-utils.ts`)

Shared test utilities for direct tool handler invocation without a real MCP server.

- **`makeTestServer()`** -- Returns a stub `McpServer` that captures handlers, plus a `callTool(name, args)` function.
- **`makeCtx(store, server)`** -- Creates a minimal `ServerContext` with a real `RecipeStore` and stub client/cache.
- **`getText(result)`** -- Extracts the text string from a `CallToolResult`.

## Boundaries

- Tool handlers **must not** import from `paprika/` or `cache/` at runtime -- access data through `ctx.store` on `ServerContext`.
- `import type` from `paprika/` and `cache/` is allowed (no runtime footprint).
- Runtime imports from `utils/` are allowed (cross-cutting utilities, e.g., `parseDuration`).

## Dependencies

- **Used by:** `index.ts` (MCP server registration)
- **Uses:** `types/` (ServerContext), `utils/` (parseDuration -- runtime), `paprika/types.ts` and `cache/recipe-store.ts` (type-only imports)
