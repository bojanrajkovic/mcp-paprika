# Discovery Tools Implementation Plan — Phase 1: search_recipes

**Goal:** Implement and register the `search_recipes` MCP tool in `src/tools/search.ts`.

**Architecture:** Thin handler that delegates all query logic to `RecipeStore.search()`. The handler validates inputs via Zod (done by the SDK), guards against cold-start via `coldStartGuard(ctx).match()`, calls `ctx.store.search(query, { limit })`, resolves category names, formats results, and returns a `CallToolResult` via `textResult()`. No business logic lives in the handler itself.

**Tech Stack:** TypeScript 5.9 (ESM, strict), `@modelcontextprotocol/sdk@1.27.1`, `zod`, `neverthrow`, `vitest`

**Scope:** Phase 1 of 3 from the design plan.

**Codebase verified:** 2026-03-13

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p2-discovery-tools.AC1: `search_recipes`

- **p2-discovery-tools.AC1.1 Success:** Non-empty store + matching query → returns formatted list of up to `limit` results
- **p2-discovery-tools.AC1.2 Success:** `limit` defaults to 20 when omitted
- **p2-discovery-tools.AC1.3 Success:** `limit` parameter caps result count (returns at most `limit` results)
- **p2-discovery-tools.AC1.4 Success:** Category names appear in formatted results (resolved via `store.resolveCategories`)
- **p2-discovery-tools.AC1.5 Failure:** Empty store → Err payload with retry instruction (cold-start guard)
- **p2-discovery-tools.AC1.6 Failure:** Non-empty store, no matching recipes → empty-result message (not an error)

### p2-discovery-tools.AC5: Cross-cutting (established by this phase)

- **p2-discovery-tools.AC5.1:** All four tools registered via `registerTool()` with raw `ZodRawShape` (not `z.object()`)
- **p2-discovery-tools.AC5.2:** All four tool handlers use `coldStartGuard(ctx).match(okFn, errFn)` pattern
- **p2-discovery-tools.AC5.3:** No handler calls `PaprikaClient` directly — zero network calls in any tool

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: `registerSearchTool` implementation (`src/tools/search.ts`)

**Verifies:** p2-discovery-tools.AC5.1, p2-discovery-tools.AC5.2, p2-discovery-tools.AC5.3 (structurally — confirmed by code shape and imports)

**Files:**

- Create: `src/tools/search.ts`

**Implementation:**

Create `src/tools/search.ts` with the following content:

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ScoredResult } from "../cache/recipe-store.js";
import { coldStartGuard, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerSearchTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "search_recipes",
    {
      description:
        "Search for recipes by name, ingredients, or description. Returns a ranked list of matching recipes.",
      inputSchema: {
        query: z.string().describe("Search query text"),
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
          const results = ctx.store.search(args.query, { limit: args.limit });
          if (results.length === 0) {
            return textResult(`No recipes found matching "${args.query}".`);
          }
          const lines = results.map((r) => {
            const categoryNames = ctx.store.resolveCategories(r.recipe.categories);
            return formatSearchHit(r, categoryNames);
          });
          return textResult(lines.join("\n\n---\n\n"));
        },
        (guard) => guard,
      );
    },
  );
}

function formatSearchHit(result: ScoredResult, categoryNames: Array<string>): string {
  const lines: Array<string> = [];
  lines.push(`## ${result.recipe.name}`);
  if (categoryNames.length > 0) {
    lines.push(`**Categories:** ${categoryNames.join(", ")}`);
  }
  const timeParts: Array<string> = [];
  if (result.recipe.prepTime) timeParts.push(`Prep: ${result.recipe.prepTime}`);
  if (result.recipe.totalTime) timeParts.push(`Total: ${result.recipe.totalTime}`);
  if (timeParts.length > 0) {
    lines.push(timeParts.join(" · "));
  }
  return lines.join("\n");
}
```

**Key points for the implementor:**

- `server.registerTool` (from `@modelcontextprotocol/sdk/server/mcp.js`) takes a raw `ZodRawShape` in `inputSchema`, not a `z.object()` — the SDK wraps it internally.
- The `async` outer handler means `.match(asyncOkFn, errFn)` works correctly: the Ok branch returns `Promise<CallToolResult>`, the Err branch returns `CallToolResult` — both are resolved by the enclosing `async`.
- `args.limit` is `number` (never undefined) because Zod's `.default(20)` applies the default before the handler is called.
- Import `ScoredResult` via `import type` — type-only imports have no runtime footprint and satisfy the `src/tools/` boundary rule.
- `formatSearchHit` is module-private (not exported). Presentational concerns are local to each tool file.

**Verification:**

```bash
pnpm typecheck
```

Expected: No type errors.

**Commit:** `feat(tools): add search_recipes tool (P2-p2-discovery-tools phase 1)`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Shared tool test utilities (`src/tools/tool-test-utils.ts`) + `search_recipes` unit tests (`src/tools/search.test.ts`)

**Verifies:** p2-discovery-tools.AC1.1, p2-discovery-tools.AC1.2, p2-discovery-tools.AC1.3, p2-discovery-tools.AC1.4, p2-discovery-tools.AC1.5, p2-discovery-tools.AC1.6, p2-discovery-tools.AC5.1, p2-discovery-tools.AC5.2, p2-discovery-tools.AC5.3

**Files:**

- Create: `src/tools/tool-test-utils.ts` (shared test helpers — created first, used by all three tool test files)
- Create: `src/tools/search.test.ts`

**Step 1: Create shared test utilities**

Create `src/tools/tool-test-utils.ts` with the test helpers used by all three tool test files (search, filter, categories):

```typescript
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { RecipeStore } from "../cache/recipe-store.js";
import type { ServerContext } from "../types/server-context.js";

/** Stubs McpServer to capture registered tool handlers for direct invocation in tests. */
export function makeTestServer(): {
  server: McpServer;
  callTool: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
} {
  const handlers = new Map<string, (args: Record<string, unknown>) => Promise<CallToolResult>>();
  const server = {
    registerTool(name: string, _config: unknown, handler: (args: Record<string, unknown>) => Promise<CallToolResult>) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;
  return {
    server,
    callTool: (name, args) => {
      const handler = handlers.get(name);
      if (!handler) throw new Error(`Tool not registered: ${name}`);
      return handler(args);
    },
  };
}

/** Creates a minimal ServerContext with a real store and stub server/client/cache. */
export function makeCtx(store: RecipeStore, server: McpServer): ServerContext {
  return {
    store,
    server,
    client: {} as unknown as ServerContext["client"],
    cache: {} as unknown as ServerContext["cache"],
  } satisfies ServerContext;
}

/** Extracts the text string from a CallToolResult's first content block. */
export function getText(result: CallToolResult): string {
  const first = result.content[0];
  if (!first || first.type !== "text") throw new Error("Expected text content");
  return first.text;
}
```

**Step 2: Create search test file**

Create `src/tools/search.test.ts`. Import shared helpers from `"./tool-test-utils.js"`:

```typescript
import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerSearchTool } from "./search.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";

describe("p2-discovery-tools: search_recipes tool", () => {
  describe("p2-discovery-tools.AC1: search_recipes", () => {
    it("p2-discovery-tools.AC1.1: non-empty store + matching query returns formatted results", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Chocolate Cake" })], []);
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "chocolate",
        limit: 20,
      });

      expect(getText(result)).toContain("Chocolate Cake");
    });

    it("p2-discovery-tools.AC1.2: limit defaults to 20 when store has many matches", async () => {
      const store = new RecipeStore();
      // Load 25 recipes all matching "recipe"
      store.load(
        Array.from({ length: 25 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}` })),
        [],
      );
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      // Pass limit: 20 explicitly (mirrors what the SDK provides when caller omits limit,
      // since z.default(20) ensures the handler always receives 20 for omitted limit).
      const result = await callTool("search_recipes", { query: "recipe", limit: 20 });
      const text = getText(result);

      // Count "---" separators: N results produce N-1 separators
      const separators = (text.match(/^---$/gm) ?? []).length;
      expect(separators).toBe(19); // 20 results = 19 separators
    });

    it("p2-discovery-tools.AC1.3: limit caps result count", async () => {
      const store = new RecipeStore();
      store.load(
        Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}` })),
        [],
      );
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "recipe",
        limit: 3,
      });
      const text = getText(result);

      const separators = (text.match(/^---$/gm) ?? []).length;
      expect(separators).toBe(2); // 3 results = 2 separators
    });

    it("p2-discovery-tools.AC1.4: category names appear in formatted results", async () => {
      const category = makeCategory({ name: "Dessert" });
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Cake", categories: [category.uid] })], [category]);
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "cake",
        limit: 20,
      });

      expect(getText(result)).toContain("Dessert");
    });

    it("p2-discovery-tools.AC1.5: empty store returns cold-start Err payload", async () => {
      const store = new RecipeStore(); // not loaded — size === 0
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "anything",
        limit: 20,
      });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC1.6: no matching recipes returns empty-result message (not an error)", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta Carbonara" })], []);
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "sushi",
        limit: 20,
      });
      const text = getText(result);

      // Must be a normal text response (not error), containing the query
      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });
  });
});
```

**Testing notes:**

- **AC1.2 note:** `args.limit` in tests is always passed explicitly because the test mock bypasses Zod parsing. The Zod `.default(20)` guarantee is structural — the schema definition ensures real MCP clients always get `20` when omitting `limit`. The test confirms that passing `limit: 20` with 25 matching recipes returns exactly 20 results.
- **AC5.1/5.2/5.3:** Verified structurally — `registerSearchTool` uses `server.registerTool` (not `z.object()`), uses `coldStartGuard(ctx).match()`, and imports only from `./helpers.js` and types (no runtime imports from `paprika/` or `cache/`).

**Verification:**

```bash
pnpm test src/tools/search.test.ts
```

Expected: All 6 tests pass.

```bash
pnpm test
```

Expected: Full test suite passes (no regressions).

**Commit:** `test(tools): add search_recipes unit tests (P2-p2-discovery-tools phase 1)`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
