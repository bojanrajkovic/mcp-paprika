# MCP Tool Definitions

Last verified: 2026-03-13

Purpose: Defines MCP tools that AI assistants can invoke.

## Shared Helpers (`helpers.ts`)

All tool handlers import shared utilities from `./helpers.js` (same-directory) or `../tools/helpers.js` (cross-directory from outside `src/tools/`).

### `textResult(text: string)`

Wraps a plain string in the MCP wire response envelope.

```typescript
import { textResult } from "./helpers.js";

// Returns: { content: [{ type: "text", text }] }
// Satisfies CallToolResult while preserving the narrow literal type.
return textResult("Hello, world!");
```

### `coldStartGuard(ctx: ServerContext)`

Returns `Ok<void>` when the recipe store has recipes (sync complete), or `Err<CallToolResult>` when the store is empty (cold start). Use `.match()` to handle both branches:

```typescript
import { coldStartGuard, textResult } from "./helpers.js";

return coldStartGuard(ctx).match(
  () => {
    // store is ready — execute tool logic
    return textResult("result");
  },
  (guard) => guard, // return the ready-to-send error directly
);
```

### `recipeToMarkdown(recipe: Recipe, categoryNames: string[])`

Renders a full Recipe as human-readable markdown. `categoryNames` must be pre-resolved via `ctx.store.resolveCategories(recipe.categories)` before calling.

Optional recipe fields (`description`, `notes`, `nutritionalInfo`, `source`, etc.) are omitted entirely when `null` or falsy — no empty headings appear.

```typescript
import { recipeToMarkdown, textResult } from "./helpers.js";

const categoryNames = ctx.store.resolveCategories(recipe.categories);
return textResult(recipeToMarkdown(recipe, categoryNames));
```

## Boundaries

- Tool handlers **must not** import from `paprika/` or `cache/` at runtime — use `ServerContext` (via `features/` or the context object) as the intermediary.
- `helpers.ts` is an exception: it uses `import type` from `paprika/` for the `Recipe` type. Type-only imports have no runtime footprint and do not violate the boundary.

## Dependencies

- Used by: `index.ts` (MCP server registration)
- Uses: `types/` (ServerContext), `paprika/types.ts` (Recipe, via `import type` only)
