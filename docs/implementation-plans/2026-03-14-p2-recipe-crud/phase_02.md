# Recipe CRUD — Phase 2: `read_recipe` Tool

**Goal:** Implement the `read_recipe` MCP tool. Supports UID lookup (exact, via `store.get`) and fuzzy title search (via `store.findByName`), with title disambiguation when multiple recipes match.

**Architecture:** Read-only — touches only `ctx.store`, no network calls or cache writes. Follows the same registration pattern as `search.ts`, `filter.ts`, and `categories.ts`. Cold-start guard applied via `coldStartGuard(ctx).match()`.

**Tech Stack:** TypeScript 5.9, @modelcontextprotocol/sdk, zod, neverthrow, Vitest

**Scope:** Phase 2 of 5

**Codebase verified:** 2026-03-14

---

## Acceptance Criteria Coverage

### p2-recipe-crud.AC1: read_recipe returns recipe content

- **p2-recipe-crud.AC1.1 Success:** UID lookup returns the recipe as markdown
- **p2-recipe-crud.AC1.2 Success:** Exact title match returns the single matching recipe as markdown
- **p2-recipe-crud.AC1.3 Success:** Partial title match (startsWith/includes) returns the recipe when exactly one match exists
- **p2-recipe-crud.AC1.4 Success:** Multiple title matches return a disambiguation list with name and UID for each
- **p2-recipe-crud.AC1.5 Failure:** UID not found returns a not-found message
- **p2-recipe-crud.AC1.6 Failure:** Title search with no matches returns a not-found message
- **p2-recipe-crud.AC1.7 Failure:** Neither uid nor title provided returns an error message
- **p2-recipe-crud.AC1.8 Failure:** Cold-start (store empty) returns cold-start guard error
- **p2-recipe-crud.AC1.9 Edge:** Both uid and title provided — uid takes precedence

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->

### Task 1: Create `src/tools/read.ts`

**Files:**

- Create: `src/tools/read.ts`

**Implementation:**

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeUidSchema } from "../paprika/types.js";
import { coldStartGuard, recipeToMarkdown, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerReadTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "read_recipe",
    {
      description:
        "Read a recipe by UID or title. When both are provided, UID takes precedence. " +
        "Title lookup is fuzzy (exact → starts-with → contains). Returns a disambiguation " +
        "list when multiple recipes match the same tier.",
      inputSchema: {
        uid: z.string().optional().describe("Exact recipe UID"),
        title: z.string().optional().describe("Recipe title (fuzzy match)"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (!args.uid && !args.title) {
            return textResult("Please provide either a uid or a title.");
          }

          // UID lookup takes precedence when both are provided (AC1.9)
          if (args.uid) {
            const recipe = ctx.store.get(RecipeUidSchema.parse(args.uid));
            if (!recipe) {
              return textResult(`No recipe found with UID "${args.uid}".`);
            }
            const categoryNames = ctx.store.resolveCategories(recipe.categories);
            return textResult(recipeToMarkdown(recipe, categoryNames));
          }

          // Title fuzzy search — args.title is defined here
          const matches = ctx.store.findByName(args.title!);

          if (matches.length === 0) {
            return textResult(`No recipes found matching "${args.title}".`);
          }

          if (matches.length === 1) {
            const recipe = matches[0]!; // safe: length === 1
            const categoryNames = ctx.store.resolveCategories(recipe.categories);
            return textResult(recipeToMarkdown(recipe, categoryNames));
          }

          // Disambiguation list (AC1.4)
          const list = matches.map((r) => `- ${r.name} (UID: ${r.uid})`).join("\n");
          return textResult(
            `Multiple recipes match "${args.title}":\n${list}\n\nPlease re-invoke with a specific uid.`,
          );
        },
        (guard) => guard,
      );
    },
  );
}
```

**Key points:**

- `RecipeUidSchema.parse(args.uid)` converts `string` → `RecipeUid` branded type safely (Zod validates it's a string, then brands it)
- `matches[0]!` is safe after the `length === 1` check; the non-null assertion is necessary because `noUncheckedIndexedAccess` is enabled in `@tsconfig/strictest`
- `args.title!` non-null assertion is safe because `!args.uid && !args.title` guard above ensures `title` is defined here
- `store.findByName` always returns results from a single tier (exact OR starts-with OR contains — never mixed)

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create `src/tools/read.test.ts`

**Files:**

- Create: `src/tools/read.test.ts`

**Testing:**

Use `makeTestServer()`, `makeCtx(store, server)` (no overrides needed — read-only tool), and `callTool("read_recipe", args)`. Use `makeRecipe()` and `makeCategory()` fixtures.

Test structure mirrors `categories.test.ts`. Each AC case gets its own `it()` block with the full AC identifier.

Tests must verify:

- **p2-recipe-crud.AC1.1:** Call `callTool("read_recipe", { uid: recipe.uid })` on a loaded store. Result text must contain the recipe name (`# Recipe Name` markdown heading). Also verify category names appear when the recipe has categories.

- **p2-recipe-crud.AC1.2:** Load a recipe with `name: "Chocolate Cake"`. Call with `{ title: "Chocolate Cake" }` (exact match). Result contains `# Chocolate Cake`.

- **p2-recipe-crud.AC1.3:** Load a recipe with `name: "Chocolate Cake"`. Call with `{ title: "Choco" }` (starts-with) and separately with `{ title: "late Ca" }` (includes). Each returns the recipe markdown.

- **p2-recipe-crud.AC1.4:** Load two recipes with names that share a common prefix (e.g., `"Pasta Bolognese"` and `"Pasta Carbonara"`). Call with `{ title: "Pasta" }`. Result must contain both names and their UIDs. Must NOT contain `## Ingredients` (it's a list, not a full recipe).

- **p2-recipe-crud.AC1.5:** Call with `{ uid: "nonexistent-uid" }`. Result text contains "not found" (case-insensitive).

- **p2-recipe-crud.AC1.6:** Call with `{ title: "Zyzzyva Surprise" }` (no matching recipe). Result text contains "not found" (case-insensitive).

- **p2-recipe-crud.AC1.7:** Call with `{}` (neither uid nor title). Result text contains an error indicating both are missing (e.g., "provide either a uid or a title").

- **p2-recipe-crud.AC1.8:** Use an empty `RecipeStore` (not loaded). Call with `{ uid: "anything" }`. Result text contains "try again" (case-insensitive) — cold-start guard message.

- **p2-recipe-crud.AC1.9:** Load a recipe. Also create a second recipe with a matching title. Call with `{ uid: firstRecipe.uid, title: secondRecipe.name }`. Result must contain the first recipe's name (UID wins).

**Import pattern:**

```typescript
import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerReadTool } from "./read.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { CategoryUid } from "../paprika/types.js";
```

**Verification:**

```bash
pnpm test src/tools/read.test.ts
```

Expected: all 9+ tests pass.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Commit

```bash
git add src/tools/read.ts src/tools/read.test.ts
git commit -m "feat(tools): add read_recipe tool with UID and fuzzy title lookup (p2-recipe-crud AC1)"
```

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
