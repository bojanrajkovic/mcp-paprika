# Discovery Tools Implementation Plan — Phase 3: list_categories

**Goal:** Implement and register the `list_categories` MCP tool in `src/tools/categories.ts`.

**Architecture:** Thin handler that calls `ctx.store.getAllCategories()` and `ctx.store.getAll()` to build a per-category recipe count map, sorts categories alphabetically, and formats the result. No input parameters. Cold-start guard prevents returning stale empty results. A category with zero associated non-trashed recipes still appears in the list with count 0.

**Tech Stack:** TypeScript 5.9 (ESM, strict), `@modelcontextprotocol/sdk@1.27.1`, `zod`, `neverthrow`, `vitest`

**Scope:** Phase 3 of 3 from the design plan.

**Codebase verified:** 2026-03-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p2-discovery-tools.AC4: `list_categories`

- **p2-discovery-tools.AC4.1 Success:** Returns all categories with non-trashed recipe count per category
- **p2-discovery-tools.AC4.2 Success:** Categories sorted alphabetically by name
- **p2-discovery-tools.AC4.3 Success:** Category with zero matching non-trashed recipes appears in list with count 0
- **p2-discovery-tools.AC4.4 Failure:** Empty store → cold-start Err payload
- **p2-discovery-tools.AC4.5 Edge:** Store populated with recipes but no categories → returns appropriate empty message

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: `registerCategoryTools` implementation (`src/tools/categories.ts`)

**Verifies:** p2-discovery-tools.AC5.1, p2-discovery-tools.AC5.2, p2-discovery-tools.AC5.3 (structurally)

**Files:**

- Create: `src/tools/categories.ts`

**Implementation:**

Create `src/tools/categories.ts` with the following content:

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Category } from "../paprika/types.js";
import { coldStartGuard, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerCategoryTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "list_categories",
    {
      description:
        "List all recipe categories with the number of recipes in each. Categories are sorted alphabetically.",
      inputSchema: {},
    },
    async (_args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const categories = ctx.store.getAllCategories();
          if (categories.length === 0) {
            return textResult("No categories found in your recipe library.");
          }

          const recipes = ctx.store.getAll();

          // Initialize every category with count 0 so categories with no recipes
          // still appear in the output (AC4.3).
          const countMap = new Map<string, number>();
          for (const category of categories) {
            countMap.set(category.uid, 0);
          }

          // Increment count for each non-trashed recipe's categories.
          // getAll() already excludes trashed recipes.
          for (const recipe of recipes) {
            for (const uid of recipe.categories) {
              const current = countMap.get(uid) ?? 0;
              countMap.set(uid, current + 1);
            }
          }

          const sorted = categories.toSorted((a, b) => a.name.localeCompare(b.name));

          return textResult(formatCategoryList(sorted, countMap));
        },
        (guard) => guard,
      );
    },
  );
}

function formatCategoryList(categories: Array<Category>, countMap: Map<string, number>): string {
  const lines = categories.map((c) => {
    const count = countMap.get(c.uid) ?? 0;
    return `- **${c.name}** (${String(count)} ${count === 1 ? "recipe" : "recipes"})`;
  });
  return `## Recipe Categories\n\n${lines.join("\n")}`;
}
```

**Key points for the implementor:**

- `inputSchema: {}` is an empty raw `ZodRawShape` — the SDK wraps it in `z.object({})`. This is the correct way to register a tool with no inputs (AC5.1).
- Initialize `countMap` with 0 for every category before iterating recipes. This is the critical step that ensures AC4.3 — a category that exists but has no recipes must appear with count 0, not be missing from the output.
- `getAllCategories()` returns all categories without filtering. `getAll()` returns only non-trashed recipes. Together they compute the correct non-trashed recipe count per category.
- `categories.toSorted()` (ES2023 non-mutating sort) produces a new sorted array without modifying the original. Use `localeCompare` for correct alphabetical ordering.
- `import type { Category }` — type-only import from `paprika/types.js` has no runtime footprint, satisfying the `src/tools/` boundary rule.

**Verification:**

```bash
pnpm typecheck
```

Expected: No type errors.

**Commit:** `feat(tools): add list_categories tool (P2-p2-discovery-tools phase 3)`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: `list_categories` unit tests (`src/tools/categories.test.ts`)

**Verifies:** p2-discovery-tools.AC4.1, p2-discovery-tools.AC4.2, p2-discovery-tools.AC4.3, p2-discovery-tools.AC4.4, p2-discovery-tools.AC4.5

**Files:**

- Create: `src/tools/categories.test.ts`
- Prerequisite: `src/tools/tool-test-utils.ts` must exist (created in Phase 1 Task 2)

**Testing approach:**

Import shared test helpers from `"./tool-test-utils.js"` (created in Phase 1 Task 2). Tests use `makeRecipe()` and `makeCategory()` fixtures. Fixture categories have auto-generated UIDs (`category-N`). Recipes reference these UIDs in their `categories` field.

```typescript
import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerCategoryTools } from "./categories.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { CategoryUid } from "../paprika/types.js";

describe("p2-discovery-tools: list_categories tool", () => {
  describe("p2-discovery-tools.AC4: list_categories", () => {
    it("p2-discovery-tools.AC4.1: returns all categories with non-trashed recipe counts", async () => {
      const catA = makeCategory({ name: "Desserts" });
      const catB = makeCategory({ name: "Mains" });
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ categories: [catA.uid] }),
          makeRecipe({ categories: [catA.uid] }),
          makeRecipe({ categories: [catB.uid] }),
          // Trashed recipe — should NOT count
          makeRecipe({ categories: [catA.uid], inTrash: true }),
        ],
        [catA, catB],
      );
      const { server, callTool } = makeTestServer();
      registerCategoryTools(server, makeCtx(store, server));

      const result = await callTool("list_categories", {});
      const text = getText(result);

      // Desserts has 2 non-trashed recipes (trashed one excluded)
      expect(text).toContain("Desserts");
      expect(text).toContain("2 recipes");
      // Mains has 1 recipe
      expect(text).toContain("Mains");
      expect(text).toContain("1 recipe");
    });

    it("p2-discovery-tools.AC4.2: categories sorted alphabetically by name", async () => {
      const catZ = makeCategory({ name: "Zucchini Dishes" });
      const catA = makeCategory({ name: "Appetizers" });
      const catM = makeCategory({ name: "Main Courses" });
      const store = new RecipeStore();
      // Need at least one recipe so store.size > 0 (cold-start guard)
      store.load([makeRecipe({ categories: [] as Array<CategoryUid> })], [catZ, catA, catM]);
      const { server, callTool } = makeTestServer();
      registerCategoryTools(server, makeCtx(store, server));

      const result = await callTool("list_categories", {});
      const text = getText(result);

      const posA = text.indexOf("Appetizers");
      const posM = text.indexOf("Main Courses");
      const posZ = text.indexOf("Zucchini Dishes");

      expect(posA).toBeLessThan(posM);
      expect(posM).toBeLessThan(posZ);
    });

    it("p2-discovery-tools.AC4.3: category with zero non-trashed recipes appears with count 0", async () => {
      const catEmpty = makeCategory({ name: "Empty Category" });
      const catFull = makeCategory({ name: "Full Category" });
      const store = new RecipeStore();
      store.load([makeRecipe({ categories: [catFull.uid] })], [catEmpty, catFull]);
      const { server, callTool } = makeTestServer();
      registerCategoryTools(server, makeCtx(store, server));

      const result = await callTool("list_categories", {});
      const text = getText(result);

      expect(text).toContain("Empty Category");
      expect(text).toContain("0 recipes");
      expect(text).toContain("Full Category");
      expect(text).toContain("1 recipe");
    });

    it("p2-discovery-tools.AC4.4: empty store returns cold-start Err payload", async () => {
      const store = new RecipeStore(); // not loaded — size === 0
      const { server, callTool } = makeTestServer();
      registerCategoryTools(server, makeCtx(store, server));

      const result = await callTool("list_categories", {});

      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC4.5: store with recipes but no categories returns empty message", async () => {
      const store = new RecipeStore();
      // Load recipes but pass empty categories array
      store.load([makeRecipe({ categories: [] as Array<CategoryUid> })], []);
      const { server, callTool } = makeTestServer();
      registerCategoryTools(server, makeCtx(store, server));

      const result = await callTool("list_categories", {});
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no categories");
    });
  });
});
```

**Testing notes:**

- **AC4.1 count accuracy:** The trashed recipe is included in `store.load()` but `getAll()` excludes it, so the count is 2 (not 3) for Desserts. This confirms the handler uses `getAll()` (filtered) not `this.recipes.values()` (unfiltered).
- **AC4.2 sort order:** Relies on `categories.toSorted((a, b) => a.name.localeCompare(b.name))`. Test loads categories in reverse order to confirm sorting is applied.
- **AC4.3 zero count:** `makeCategory` creates a real category with a unique UID. Loading it into the store without any recipes referencing it tests that the `countMap` initialization to 0 works correctly.
- **AC4.5 empty categories path:** `store.size > 0` (one recipe loaded) so cold-start guard passes, but `getAllCategories()` returns `[]`. The handler returns the "no categories" message, not the cold-start error.

**Verification:**

```bash
pnpm test src/tools/categories.test.ts
```

Expected: All 5 tests pass.

```bash
pnpm test
```

Expected: Full test suite passes (no regressions).

**Commit:** `test(tools): add list_categories unit tests (P2-p2-discovery-tools phase 3)`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
