# Discovery Tools Implementation Plan — Phase 2: filter_by_ingredient + filter_by_time

**Goal:** Implement and register the `filter_by_ingredient` and `filter_by_time` MCP tools in `src/tools/filter.ts`.

**Architecture:** Single file exports `registerFilterTools(server, ctx)` which registers two tools. Both use `coldStartGuard(ctx).match()`. A shared private `formatRecipeList(recipes, ctx)` formats results for both. The `filter_by_time` tool must convert its string inputs ("30 minutes") to minutes (numbers) via `parseDuration` before passing to `RecipeStore.filterByTime()` — the store takes `TimeConstraints` with numeric minute values, not raw strings.

**Design discrepancy (corrected here):** The design plan states "time strings passed directly to filterByTime — the store uses parseDuration internally." This is **incorrect**: `TimeConstraints` uses `number` (minutes), and the store's `parseDuration` is called on _recipe fields_ (not constraint values). The tool handler must parse the input strings and convert to minutes before calling the store.

**Tech Stack:** TypeScript 5.9 (ESM, strict), `@modelcontextprotocol/sdk@1.27.1`, `zod`, `neverthrow`, `src/utils/duration.ts` (parseDuration), `vitest`

**Scope:** Phase 2 of 3 from the design plan.

**Codebase verified:** 2026-03-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p2-discovery-tools.AC2: `filter_by_ingredient`

- **p2-discovery-tools.AC2.1 Success:** `mode="all"` → returns only recipes containing all listed ingredients
- **p2-discovery-tools.AC2.2 Success:** `mode="any"` → returns recipes containing any listed ingredient
- **p2-discovery-tools.AC2.3 Success:** `mode` defaults to `"all"` when omitted
- **p2-discovery-tools.AC2.4 Success:** `limit` defaults to 20 when omitted
- **p2-discovery-tools.AC2.5 Failure:** Empty store → cold-start Err payload
- **p2-discovery-tools.AC2.6 Failure:** No recipes match → empty-result message

### p2-discovery-tools.AC3: `filter_by_time`

- **p2-discovery-tools.AC3.1 Success:** `maxTotalTime` constraint returns only recipes with `totalTime` ≤ constraint
- **p2-discovery-tools.AC3.2 Success:** `maxPrepTime` constraint returns only recipes with `prepTime` ≤ constraint
- **p2-discovery-tools.AC3.3 Success:** `maxCookTime` constraint returns only recipes with `cookTime` ≤ constraint
- **p2-discovery-tools.AC3.4 Success:** Results ordered by total time ascending
- **p2-discovery-tools.AC3.5 Success:** `limit` applied post-store via `.slice(0, limit)` — at most `limit` results returned
- **p2-discovery-tools.AC3.6 Edge:** All three time constraints optional — tool accepts any combination (including all omitted, returning all recipes sorted by time up to limit)
- **p2-discovery-tools.AC3.7 Failure:** Empty store → cold-start Err payload
- **p2-discovery-tools.AC3.8 Failure:** No recipes match constraints → empty-result message

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: `registerFilterTools` implementation (`src/tools/filter.ts`)

**Verifies:** p2-discovery-tools.AC5.1, p2-discovery-tools.AC5.2, p2-discovery-tools.AC5.3 (structurally)

**Files:**

- Create: `src/tools/filter.ts`

**Implementation:**

Create `src/tools/filter.ts` with the following content:

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type Result } from "neverthrow";
import type { Recipe } from "../paprika/types.js";
import { parseDuration } from "../utils/duration.js";
import { coldStartGuard, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerFilterTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "filter_by_ingredient",
    {
      description:
        'Filter recipes by ingredient. Use mode="all" (default) to require all ingredients, or mode="any" to match any.',
      inputSchema: {
        ingredients: z.array(z.string()).min(1).describe("One or more ingredient terms to filter by"),
        mode: z
          .enum(["all", "any"])
          .default("all")
          .describe('Match mode: "all" (default) requires every ingredient; "any" matches at least one'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(20)
          .describe("Maximum number of results to return (default: 20, max: 50)"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const results = ctx.store.filterByIngredients(args.ingredients, args.mode, args.limit);
          if (results.length === 0) {
            const qualifier = args.mode === "all" ? "all of" : "any of";
            return textResult(`No recipes found containing ${qualifier}: ${args.ingredients.join(", ")}.`);
          }
          return textResult(formatRecipeList(results, ctx));
        },
        (guard) => guard,
      );
    },
  );

  server.registerTool(
    "filter_by_time",
    {
      description:
        "Filter recipes by prep, cook, or total time. All constraints are optional. Results sorted by total time ascending.",
      inputSchema: {
        maxPrepTime: z.string().optional().describe('Maximum prep time (e.g., "30 minutes", "1 hr")'),
        maxCookTime: z.string().optional().describe('Maximum cook time (e.g., "45 min", "1 hour")'),
        maxTotalTime: z.string().optional().describe('Maximum total time (e.g., "1 hour 30 minutes", "2 hrs")'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(20)
          .describe("Maximum number of results to return (default: 20, max: 50)"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const constraintsResult = parseMaybeMinutes(args.maxPrepTime).andThen((maxPrepTime) =>
            parseMaybeMinutes(args.maxCookTime).andThen((maxCookTime) =>
              parseMaybeMinutes(args.maxTotalTime).map((maxTotalTime) => ({
                maxPrepTime,
                maxCookTime,
                maxTotalTime,
              })),
            ),
          );

          return constraintsResult.match(
            (constraints) => {
              const allResults = ctx.store.filterByTime(constraints);
              const results = allResults.slice(0, args.limit);
              if (results.length === 0) {
                return textResult("No recipes found matching the specified time constraints.");
              }
              return textResult(formatRecipeList(results, ctx));
            },
            (errorMsg) => textResult(errorMsg),
          );
        },
        (guard) => guard,
      );
    },
  );
}

// Parses a human-readable time string to minutes, or passes through undefined.
// Returns Err with a user-friendly message if parsing fails.
function parseMaybeMinutes(input: string | undefined): Result<number | undefined, string> {
  if (input === undefined) return ok(undefined);
  return parseDuration(input)
    .map((d) => d.as("minutes"))
    .mapErr((e) => `Invalid time format "${e.input}": ${e.reason}`);
}

function formatRecipeList(recipes: Array<Recipe>, ctx: ServerContext): string {
  const lines = recipes.map((recipe) => {
    const categoryNames = ctx.store.resolveCategories(recipe.categories);
    return formatRecipeItem(recipe, categoryNames);
  });
  return lines.join("\n\n---\n\n");
}

function formatRecipeItem(recipe: Recipe, categoryNames: Array<string>): string {
  const lines: Array<string> = [];
  lines.push(`## ${recipe.name}`);
  if (categoryNames.length > 0) {
    lines.push(`**Categories:** ${categoryNames.join(", ")}`);
  }
  const timeParts: Array<string> = [];
  if (recipe.prepTime) timeParts.push(`Prep: ${recipe.prepTime}`);
  if (recipe.totalTime) timeParts.push(`Total: ${recipe.totalTime}`);
  if (timeParts.length > 0) {
    lines.push(timeParts.join(" · "));
  }
  return lines.join("\n");
}
```

**Key points for the implementor:**

- `parseDuration` is at `src/utils/duration.ts`. Import path: `"../utils/duration.js"`. It accepts human-readable strings (`"30 minutes"`, `"1 hr 15 min"`) and returns `Result<Duration, DurationParseError>`. Call `.as("minutes")` on the Duration value.
- `DurationParseError` has fields `input: string` and `reason: string` — use them for the user-facing error message.
- `import type { Recipe } from "../paprika/types.js"` is a type-only import — no runtime import from `paprika/` which satisfies the `src/tools/` boundary rule.
- The `constraintsResult` chain uses `.andThen()` to sequence three optional parses without any `.isOk()`/`.isErr()` checks.
- The inner `constraintsResult.match()` call is inside the `async` coldStartGuard Ok branch. It returns `CallToolResult` synchronously; the outer `async` wraps it in a Promise — no `await` needed.

**Verification:**

```bash
pnpm typecheck
```

Expected: No type errors.

**Commit:** `feat(tools): add filter_by_ingredient and filter_by_time tools (P2-p2-discovery-tools phase 2)`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Filter tools unit tests (`src/tools/filter.test.ts`)

**Verifies:** p2-discovery-tools.AC2.1 through AC2.6, p2-discovery-tools.AC3.1 through AC3.8

**Files:**

- Create: `src/tools/filter.test.ts`
- Prerequisite: `src/tools/tool-test-utils.ts` must exist (created in Phase 1 Task 2)

**Testing approach:**

Import shared test helpers from `"./tool-test-utils.js"` (created in Phase 1 Task 2). Real `RecipeStore` populated with controlled fixture data. Tests for `filter_by_time` use Paprika's native time format strings (e.g., `"15 min"`, `"30 min"`, `"45 min"`) which `parseDuration` can parse.

```typescript
import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerFilterTools } from "./filter.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";

describe("p2-discovery-tools: filter_by_ingredient tool", () => {
  describe("p2-discovery-tools.AC2: filter_by_ingredient", () => {
    it("p2-discovery-tools.AC2.1: mode=all returns only recipes with all ingredients", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
          makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
          makeRecipe({ name: "Garlic Bread", ingredients: "bread, garlic, butter" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["tomato", "garlic"],
        mode: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Pasta");
      expect(text).not.toContain("Salad");
      expect(text).not.toContain("Garlic Bread");
    });

    it("p2-discovery-tools.AC2.2: mode=any returns recipes with any ingredient", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
          makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
          makeRecipe({ name: "Rice", ingredients: "rice, water" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["tomato", "garlic"],
        mode: "any",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Pasta");
      expect(text).toContain("Salad");
      expect(text).not.toContain("Rice");
    });

    it("p2-discovery-tools.AC2.3: mode defaults to all (pass mode: all explicitly in test)", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "HasBoth", ingredients: "tomato, garlic" }),
          makeRecipe({ name: "HasOne", ingredients: "tomato, onion" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      // mode: "all" is the default — passing explicitly mirrors SDK default behavior
      const result = await callTool("filter_by_ingredient", {
        ingredients: ["tomato", "garlic"],
        mode: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("HasBoth");
      expect(text).not.toContain("HasOne");
    });

    it("p2-discovery-tools.AC2.4: limit caps results (using explicit limit=20)", async () => {
      const store = new RecipeStore();
      store.load(
        Array.from({ length: 25 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}`, ingredients: "tomato" })),
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["tomato"],
        mode: "all",
        limit: 20,
      });
      const text = getText(result);
      const separators = (text.match(/^---$/gm) ?? []).length;

      expect(separators).toBe(19); // 20 results = 19 separators
    });

    it("p2-discovery-tools.AC2.5: empty store returns cold-start Err payload", async () => {
      const store = new RecipeStore();
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["anything"],
        mode: "all",
        limit: 20,
      });

      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC2.6: no matching recipes returns empty-result message", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta", ingredients: "pasta, tomato" })], []);
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["sushi"],
        mode: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });
  });
});

describe("p2-discovery-tools: filter_by_time tool", () => {
  describe("p2-discovery-tools.AC3: filter_by_time", () => {
    it("p2-discovery-tools.AC3.1: maxTotalTime returns only recipes with totalTime <= constraint", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "Quick", totalTime: "20 min" }),
          makeRecipe({ name: "Medium", totalTime: "45 min" }),
          makeRecipe({ name: "Slow", totalTime: "2 hours" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "30 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Quick");
      expect(text).not.toContain("Medium");
      expect(text).not.toContain("Slow");
    });

    it("p2-discovery-tools.AC3.2: maxPrepTime returns only recipes with prepTime <= constraint", async () => {
      const store = new RecipeStore();
      store.load(
        [makeRecipe({ name: "QuickPrep", prepTime: "10 min" }), makeRecipe({ name: "LongPrep", prepTime: "1 hour" })],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxPrepTime: "15 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("QuickPrep");
      expect(text).not.toContain("LongPrep");
    });

    it("p2-discovery-tools.AC3.3: maxCookTime returns only recipes with cookTime <= constraint", async () => {
      const store = new RecipeStore();
      store.load(
        [makeRecipe({ name: "QuickCook", cookTime: "15 min" }), makeRecipe({ name: "SlowCook", cookTime: "3 hours" })],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxCookTime: "30 min",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("QuickCook");
      expect(text).not.toContain("SlowCook");
    });

    it("p2-discovery-tools.AC3.4: results ordered by total time ascending", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "Slow", totalTime: "60 min" }),
          makeRecipe({ name: "Fast", totalTime: "10 min" }),
          makeRecipe({ name: "Medium", totalTime: "30 min" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "2 hours",
        limit: 20,
      });
      const text = getText(result);

      const fastPos = text.indexOf("Fast");
      const mediumPos = text.indexOf("Medium");
      const slowPos = text.indexOf("Slow");

      expect(fastPos).toBeLessThan(mediumPos);
      expect(mediumPos).toBeLessThan(slowPos);
    });

    it("p2-discovery-tools.AC3.5: limit applied post-store (at most limit results)", async () => {
      const store = new RecipeStore();
      store.load(
        Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}`, totalTime: "20 min" })),
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "1 hour",
        limit: 3,
      });
      const text = getText(result);
      const separators = (text.match(/^---$/gm) ?? []).length;

      expect(separators).toBe(2); // 3 results = 2 separators
    });

    it("p2-discovery-tools.AC3.6: all constraints optional — no constraints returns all recipes sorted by time", async () => {
      const store = new RecipeStore();
      store.load(
        [makeRecipe({ name: "Alpha", totalTime: "10 min" }), makeRecipe({ name: "Beta", totalTime: "20 min" })],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", { limit: 20 });
      const text = getText(result);

      expect(text).toContain("Alpha");
      expect(text).toContain("Beta");
    });

    it("p2-discovery-tools.AC3.7: empty store returns cold-start Err payload", async () => {
      const store = new RecipeStore();
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "30 minutes",
        limit: 20,
      });

      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC3.8: no recipes match constraints returns empty-result message", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Slow", totalTime: "4 hours" })], []);
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "10 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });

    it("invalid duration string returns user-friendly error message", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Quick", totalTime: "20 min" })], []);
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "not a time",
        limit: 20,
      });
      const text = getText(result);

      // parseMaybeMinutes returns Err — handler returns user-friendly message
      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("invalid");
    });
  });
});
```

**Testing notes:**

- **AC2.3 and AC3.5/AC2.4 note:** Defaults are guaranteed by Zod `.default()` — tests always pass explicit values. The tests confirm behavior at the default values rather than testing the Zod default mechanism itself.
- **AC3.4 ordering:** Relies on `RecipeStore.filterByTime()` sorting by total time ascending. Verified structurally — the store sorts with `toSorted()` before returning.
- **AC3.6 edge case:** Calling with only `{ limit: 20 }` (no time constraints) should pass an empty `TimeConstraints` object `{}` to the store, which returns all non-trashed recipes sorted by total time. Recipes without `totalTime` sort last.
- **Invalid duration test:** Exercises the `parseMaybeMinutes()` Err path. The test confirms the handler returns a readable error message (not an exception or empty result).

**Verification:**

```bash
pnpm test src/tools/filter.test.ts
```

Expected: All 15 tests pass.

```bash
pnpm test
```

Expected: Full test suite passes (no regressions).

**Commit:** `test(tools): add filter_by_ingredient and filter_by_time unit tests (P2-p2-discovery-tools phase 2)`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
