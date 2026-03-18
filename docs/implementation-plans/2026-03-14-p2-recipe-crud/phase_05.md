# Recipe CRUD — Phase 5: `update_recipe` Tool

**Goal:** Implement the `update_recipe` MCP tool. Accepts a UID and one or more optional fields. Fetches the existing recipe from the store, merges provided fields, calls `ctx.client.saveRecipe()`, commits via `commitRecipe`, and returns the updated recipe as markdown.

**Architecture:** Partial merge: omitted fields retain existing values; `categories` fully replaces the existing list when provided (not merged). Uses conditional spread (`...(field !== undefined && { key: field })`) for the merge — keeps the update as a single object expression. `args.categories !== undefined` (not `!args.categories`) so that an empty array `[]` correctly removes all categories.

**Tech Stack:** TypeScript 5.9, @modelcontextprotocol/sdk, zod, neverthrow, Vitest + vi.fn() mocks

**Scope:** Phase 5 of 5 — depends on Phase 1 (commitRecipe, resolveCategoryNames); recommended after Phases 2–4 for coherent commit history

**Codebase verified:** 2026-03-14

---

## Acceptance Criteria Coverage

### p2-recipe-crud.AC3: update_recipe applies partial updates

- **p2-recipe-crud.AC3.1 Success:** Provided fields are updated; omitted fields retain their existing values
- **p2-recipe-crud.AC3.2 Success:** Providing categories replaces the existing category list entirely
- **p2-recipe-crud.AC3.3 Success:** Omitting categories leaves existing categories unchanged
- **p2-recipe-crud.AC3.4 Success:** saveRecipe and notifySync called with the merged recipe
- **p2-recipe-crud.AC3.5 Failure:** UID not found returns not-found message
- **p2-recipe-crud.AC3.6 Failure:** saveRecipe throws — returns error message
- **p2-recipe-crud.AC3.7 Failure:** Cold-start guard fires before store lookup

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->

### Task 1: Create `src/tools/update.ts`

**Files:**

- Create: `src/tools/update.ts`

**Implementation:**

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeUidSchema } from "../paprika/types.js";
import type { Recipe } from "../paprika/types.js";
import { coldStartGuard, commitRecipe, recipeToMarkdown, resolveCategoryNames, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerUpdateTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "update_recipe",
    {
      description:
        "Update an existing recipe by UID. Only provided fields are changed; " +
        "omitted fields retain their existing values. If categories is provided, " +
        "it replaces the existing category list entirely; omitting categories " +
        "leaves the existing list unchanged.",
      inputSchema: {
        uid: z.string().describe("Recipe UID to update"),
        name: z.string().optional().describe("New recipe name"),
        ingredients: z.string().optional().describe("New ingredients list"),
        directions: z.string().optional().describe("New cooking directions"),
        description: z.string().optional().describe("New description"),
        notes: z.string().optional().describe("New notes"),
        servings: z.string().optional().describe("New servings"),
        prepTime: z.string().optional().describe("New prep time"),
        cookTime: z.string().optional().describe("New cook time"),
        totalTime: z.string().optional().describe("New total time"),
        categories: z
          .array(z.string())
          .optional()
          .describe("Category display names — replaces existing list when provided"),
        source: z.string().optional().describe("New source name"),
        sourceUrl: z.string().optional().describe("New source URL"),
        difficulty: z.string().optional().describe("New difficulty level"),
        rating: z.number().int().min(0).max(5).optional().describe("New rating 0–5"),
        nutritionalInfo: z.string().optional().describe("New nutritional information"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = RecipeUidSchema.parse(args.uid);
          const existing = ctx.store.get(uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          // Resolve categories if provided — replaces list entirely (AC3.2)
          // Check !== undefined so empty array [] correctly removes all categories (AC3.3)
          const { uids: resolvedCategories, unknown: unknownCategories } =
            args.categories !== undefined
              ? resolveCategoryNames(ctx.store.getAllCategories(), args.categories)
              : { uids: existing.categories, unknown: [] as Array<string> };

          const warnings = unknownCategories.map((name) => `Warning: category "${name}" not found and was skipped.`);

          // Partial merge: conditional spread omits keys when value is undefined (AC3.1)
          const updated: Recipe = {
            ...existing,
            ...(args.name !== undefined && { name: args.name }),
            ...(args.ingredients !== undefined && { ingredients: args.ingredients }),
            ...(args.directions !== undefined && { directions: args.directions }),
            ...(args.description !== undefined && { description: args.description }),
            ...(args.notes !== undefined && { notes: args.notes }),
            ...(args.servings !== undefined && { servings: args.servings }),
            ...(args.prepTime !== undefined && { prepTime: args.prepTime }),
            ...(args.cookTime !== undefined && { cookTime: args.cookTime }),
            ...(args.totalTime !== undefined && { totalTime: args.totalTime }),
            ...(args.source !== undefined && { source: args.source }),
            ...(args.sourceUrl !== undefined && { sourceUrl: args.sourceUrl }),
            ...(args.difficulty !== undefined && { difficulty: args.difficulty }),
            ...(args.rating !== undefined && { rating: args.rating }),
            ...(args.nutritionalInfo !== undefined && { nutritionalInfo: args.nutritionalInfo }),
            categories: resolvedCategories, // always set — either resolved or existing
          };

          let saved: Recipe;
          try {
            saved = await ctx.client.saveRecipe(updated); // AC3.4
            await commitRecipe(ctx, saved); // AC3.4
          } catch (error) {
            return textResult(`Failed to update recipe: ${error instanceof Error ? error.message : String(error)}`);
          }

          const categoryNames = ctx.store.resolveCategories(saved.categories);
          const markdown = recipeToMarkdown(saved, categoryNames);
          const prefix = warnings.length > 0 ? warnings.join("\n") + "\n\n" : "";
          return textResult(prefix + markdown);
        },
        (guard) => guard,
      );
    },
  );
}
```

**Key points:**

- `...(condition && { key: value })` — when `condition` is `false`, spread of `false` is a no-op in TypeScript/JavaScript; the existing field from `...existing` is retained
- `categories: resolvedCategories` appears unconditionally after the conditional spreads, always setting the final category list (either replaced or existing)
- `args.categories !== undefined` distinguishes "caller wants to replace with empty list" (`[]`) from "caller did not provide categories" (`undefined`)

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create `src/tools/update.test.ts`

**Files:**

- Create: `src/tools/update.test.ts`

**Testing:**

Use the same mock injection pattern from Phase 3. `mockSaveRecipe` should return the `updated` recipe (or a `makeRecipe()` with the updated fields applied).

Tests must verify:

- **p2-recipe-crud.AC3.1:** Load a recipe with `name: "Old Name"`, `servings: "2"`. Call `callTool("update_recipe", { uid, name: "New Name" })` (omit servings). Configure `mockSaveRecipe` to return the updated recipe. Assert `mockSaveRecipe.mock.calls[0]?.[0].name === "New Name"`. Assert `mockSaveRecipe.mock.calls[0]?.[0].servings === "2"` (unchanged from existing).

- **p2-recipe-crud.AC3.2:** Load a recipe with existing categories `[catA.uid]`. Load a second category `catB`. Call with `{ uid, categories: ["Category B"] }`. Assert `mockSaveRecipe.mock.calls[0]?.[0].categories` equals `[catB.uid]` — the old `catA.uid` is gone.

- **p2-recipe-crud.AC3.3:** Load a recipe with existing categories `[catA.uid]`. Call with `{ uid, name: "New Name" }` (no categories field). Assert `mockSaveRecipe.mock.calls[0]?.[0].categories` still equals `[catA.uid]` (unchanged).

- **p2-recipe-crud.AC3.4:** After a successful update, assert `mockSaveRecipe` was called exactly once. Assert `mockNotifySync` was called exactly once (via `commitRecipe`). The argument to `saveRecipe` should reflect the merged recipe.

- **p2-recipe-crud.AC3.5:** Call with a UID not in the store. Result text contains "not found". Assert `mockSaveRecipe` was not called.

- **p2-recipe-crud.AC3.6:** Configure `mockSaveRecipe.mockRejectedValue(new Error("Conflict"))`. Call `callTool`. Result text contains "Failed to update" and "Conflict". Assert `mockPutRecipe` was not called.

- **p2-recipe-crud.AC3.7:** Use an empty `RecipeStore`. Call with any UID and any fields. Result text contains "try again". Assert `mockSaveRecipe` was not called.

**Additional edge case to add:**

- Categories provided as empty array `[]`: Load a recipe with categories. Call with `{ uid, categories: [] }`. Assert `mockSaveRecipe.mock.calls[0]?.[0].categories` is an empty array (`[]`) — confirms `!== undefined` check allows empty-array replacement.

**Import pattern:**

```typescript
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerUpdateTool } from "./update.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";
```

**Verification:**

```bash
pnpm test src/tools/update.test.ts
```

Expected: all 7+ tests pass.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Final verification and commit

Run the full test suite to confirm all phases pass together:

```bash
pnpm build
pnpm test
```

Expected: build succeeds, all tests pass (phases 1–5 plus all pre-existing tests).

```bash
git add src/tools/update.ts src/tools/update.test.ts
git commit -m "feat(tools): add update_recipe tool with partial merge and category replacement (p2-recipe-crud AC3)"
```

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Note on entry point registration

**`src/index.ts` is currently an empty placeholder** — the MCP server entry point is being built in a separate planned phase (alongside the existing discovery tools: `search_recipes`, `filter_by_ingredient`, `filter_by_time`, `list_categories`).

When the entry point phase is implemented, it must import and call all four new register functions alongside the existing ones:

```typescript
import { registerReadTool } from "./tools/read.js";
import { registerCreateTool } from "./tools/create.js";
import { registerUpdateTool } from "./tools/update.js";
import { registerDeleteTool } from "./tools/delete.js";

// In the server setup:
registerReadTool(server, ctx);
registerCreateTool(server, ctx);
registerUpdateTool(server, ctx);
registerDeleteTool(server, ctx);
```

No action required in this phase — each tool's unit tests already call `register*Tool(server, ctx)` directly to verify the tools work. The entry point registration is out of scope for p2-recipe-crud.

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->
