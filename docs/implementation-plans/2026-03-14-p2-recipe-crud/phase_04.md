# Recipe CRUD — Phase 4: `create_recipe` Tool

**Goal:** Implement the `create_recipe` MCP tool. Accepts required fields (name, ingredients, directions) and optional fields. Generates a UUID for the new recipe, resolves category names to UIDs, calls `ctx.client.saveRecipe()`, commits to local state via `commitRecipe`, and returns the created recipe as markdown.

**Architecture:** Uses `crypto.randomUUID()` (Node.js 24 built-in global — no import needed) for UID generation. Sends `hash: ""` initially; the Paprika API returns the actual hash in the response. The returned recipe (not the locally-constructed one) is passed to `commitRecipe`. Category resolution via `resolveCategoryNames` from Phase 1; unknown names produce warnings in the output.

**Tech Stack:** TypeScript 5.9, @modelcontextprotocol/sdk, zod, neverthrow, Vitest + vi.fn() mocks

**Scope:** Phase 4 of 5 — depends on Phase 1 (commitRecipe, resolveCategoryNames)

**Codebase verified:** 2026-03-14

---

## Acceptance Criteria Coverage

### p2-recipe-crud.AC2: create_recipe creates and persists a new recipe

- **p2-recipe-crud.AC2.1 Success:** Required fields (name, ingredients, directions) creates a recipe returned as markdown
- **p2-recipe-crud.AC2.2 Success:** Optional fields provided are reflected in the returned recipe
- **p2-recipe-crud.AC2.3 Success:** Optional fields omitted default to null (not empty string)
- **p2-recipe-crud.AC2.4 Success:** Valid category names are resolved to UIDs and stored on the recipe
- **p2-recipe-crud.AC2.5 Success:** saveRecipe and notifySync are called exactly once each
- **p2-recipe-crud.AC2.6 Success:** store.set and cache.putRecipe called with the saved recipe
- **p2-recipe-crud.AC2.7 Failure:** Unrecognized category name is skipped and a warning appears in output
- **p2-recipe-crud.AC2.8 Failure:** saveRecipe throws — returns error message, store/cache not updated
- **p2-recipe-crud.AC2.9 Failure:** Cold-start guard fires before any API call

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->

### Task 1: Create `src/tools/create.ts`

**Files:**

- Create: `src/tools/create.ts`

**Implementation:**

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeUidSchema } from "../paprika/types.js";
import type { CategoryUid, Recipe } from "../paprika/types.js";
import { coldStartGuard, commitRecipe, recipeToMarkdown, resolveCategoryNames, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerCreateTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "create_recipe",
    {
      description: "Create a new recipe in the Paprika account.",
      inputSchema: {
        name: z.string().describe("Recipe name"),
        ingredients: z.string().describe("Ingredients list"),
        directions: z.string().describe("Cooking directions"),
        description: z.string().optional().describe("Brief description"),
        notes: z.string().optional().describe("Additional notes"),
        servings: z.string().optional().describe("Number of servings"),
        prepTime: z.string().optional().describe("Prep time (e.g. '15 min')"),
        cookTime: z.string().optional().describe("Cook time (e.g. '30 min')"),
        totalTime: z.string().optional().describe("Total time (e.g. '45 min')"),
        categories: z.array(z.string()).optional().describe("Category display names (case-insensitive)"),
        source: z.string().optional().describe("Source name"),
        sourceUrl: z.string().optional().describe("Source URL"),
        difficulty: z.string().optional().describe("Difficulty level"),
        rating: z.number().int().min(0).max(5).optional().describe("Rating 0–5 (default: 0)"),
        nutritionalInfo: z.string().optional().describe("Nutritional information"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Resolve category names → UIDs (AC2.4, AC2.7)
          const { uids: categories, unknown: unknownCategories } =
            args.categories && args.categories.length > 0
              ? resolveCategoryNames(ctx.store.getAllCategories(), args.categories)
              : { uids: [] as Array<CategoryUid>, unknown: [] as Array<string> };

          const warnings = unknownCategories.map((name) => `Warning: category "${name}" not found and was skipped.`);

          // Build the full Recipe object — all 28 fields required by the type
          // hash: "" — Paprika API returns the real hash in the saveRecipe response
          const uid = RecipeUidSchema.parse(crypto.randomUUID());
          const newRecipe: Recipe = {
            uid,
            hash: "",
            name: args.name,
            categories,
            ingredients: args.ingredients,
            directions: args.directions,
            description: args.description ?? null, // AC2.3: omitted → null
            notes: args.notes ?? null,
            prepTime: args.prepTime ?? null,
            cookTime: args.cookTime ?? null,
            totalTime: args.totalTime ?? null,
            servings: args.servings ?? null,
            difficulty: args.difficulty ?? null,
            rating: args.rating ?? 0, // AC2.3: omitted → 0 (Paprika's default)
            created: new Date().toISOString(),
            imageUrl: "",
            photo: null,
            photoHash: null,
            photoLarge: null,
            photoUrl: null,
            source: args.source ?? null,
            sourceUrl: args.sourceUrl ?? null,
            onFavorites: false,
            inTrash: false,
            isPinned: false,
            onGroceryList: false,
            scale: null,
            nutritionalInfo: args.nutritionalInfo ?? null,
          };

          let saved: Recipe;
          try {
            saved = await ctx.client.saveRecipe(newRecipe); // AC2.5
            await commitRecipe(ctx, saved); // AC2.5, AC2.6
          } catch (error) {
            // AC2.8: store/cache not updated — commitRecipe not reached
            return textResult(`Failed to create recipe: ${error instanceof Error ? error.message : String(error)}`);
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

- `crypto.randomUUID()` is available as a global in Node.js 19+ (no import needed). TypeScript's `lib` in `@tsconfig/node24` includes the `Crypto` global type.
- `RecipeUidSchema.parse(crypto.randomUUID())` brands the string as `RecipeUid` — clean, no cast comment needed
- `[] as Array<CategoryUid>` asserts type on empty array literal (necessary because TypeScript infers `never[]`)
- `new Date().toISOString()` for `created` — acceptable in Imperative Shell
- `hash: ""` on creation — API response hash (from `saved`) is what gets committed to local state
- Warnings appear prepended to the markdown, not as a separate tool error

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create `src/tools/create.test.ts`

**Files:**

- Create: `src/tools/create.test.ts`

**Testing:**

Follow the same mock injection pattern established in Phase 3 (`delete.test.ts`). The happy-path mock for `saveRecipe` must return a `Recipe` — use `makeRecipe()` or a custom object that represents what the API would return after creating the recipe.

Since `crypto.randomUUID()` is a global, no special mocking is needed for UUID generation. Tests can verify that `mockSaveRecipe` was called with a `uid` field matching a UUID format if desired, but this is optional.

Tests must verify:

- **p2-recipe-crud.AC2.1:** Call `callTool("create_recipe", { name: "Soup", ingredients: "water", directions: "boil" })`. Configure `mockSaveRecipe` to return `makeRecipe({ name: "Soup" })`. Result text contains `# Soup`. The text contains `## Ingredients` and `## Directions`.

- **p2-recipe-crud.AC2.2:** Call with optional fields (e.g., `description: "Tasty"`, `servings: "4"`, `prepTime: "10 min"`). Configure `mockSaveRecipe` to return a recipe with those fields set. Result text contains the description and servings values.

- **p2-recipe-crud.AC2.3:** After a successful call with only required fields, inspect `mockSaveRecipe.mock.calls[0]?.[0]` (the Recipe passed to saveRecipe). Assert that `description === null`, `notes === null`, `servings === null` — not `""`. Every optional field omitted from the call must be `null` on the constructed recipe.

- **p2-recipe-crud.AC2.4:** Load a category (`makeCategory({ name: "Soups" })`) into the store. Call with `{ categories: ["Soups"], ... }`. Assert `mockSaveRecipe.mock.calls[0]?.[0].categories` contains the category's UID.

- **p2-recipe-crud.AC2.5:** After a successful call, assert `mockSaveRecipe` was called exactly once and `mockNotifySync` was called exactly once (called by `commitRecipe`).

- **p2-recipe-crud.AC2.6:** After a successful call where `mockSaveRecipe` returns `savedRecipe`, assert `mockPutRecipe` was called with `savedRecipe` as first argument and `savedRecipe.hash` as second. Assert `mockFlush` was called once. Verify the store was updated by calling `store.get(savedRecipe.uid)` — should return `savedRecipe`.

- **p2-recipe-crud.AC2.7:** Load a category `"Desserts"` but call with `{ categories: ["Desserts", "UnknownCat"], ... }`. Result text contains `Warning: category "UnknownCat" not found`. The `categories` field passed to `saveRecipe` contains only the Desserts UID (not UnknownCat).

- **p2-recipe-crud.AC2.8:** Configure `mockSaveRecipe.mockRejectedValue(new Error("Network error"))`. Call `callTool`. Result text contains "Failed to create" and "Network error". Assert `mockPutRecipe` was not called.

- **p2-recipe-crud.AC2.9:** Use an empty `RecipeStore`. Call with valid required fields. Result text contains "try again". Assert `mockSaveRecipe` was not called.

**Import pattern:**

```typescript
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerCreateTool } from "./create.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";
```

**Verification:**

```bash
pnpm test src/tools/create.test.ts
```

Expected: all 9+ tests pass.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Commit

```bash
git add src/tools/create.ts src/tools/create.test.ts
git commit -m "feat(tools): add create_recipe tool with UUID generation and category resolution (p2-recipe-crud AC2)"
```

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
