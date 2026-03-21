# Discover Recipes Tool Implementation Plan

**Goal:** Implement `registerDiscoverTool` — a semantic search MCP tool that composes `VectorStore.search()` with `RecipeStore` enrichment.

**Architecture:** Single-file tool registration (`src/tools/discover.ts`) following the existing `(server, ctx)` pattern with an additive third `vectorStore` parameter. Cold-start guard prevents search before first sync; deleted recipes are silently filtered and results re-numbered.

**Tech Stack:** TypeScript, MCP SDK (`@modelcontextprotocol/sdk`), Zod (input schema), neverthrow (cold-start guard), Vectra-backed `VectorStore`, vitest (testing)

**Scope:** 1 phase from original design (phase 1 of 1)

**Codebase verified:** 2026-03-20

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p3-u06-discover-tool.AC1: Tool registration and input schema

- **p3-u06-discover-tool.AC1.1 Success:** Tool is registered with name `discover_recipes`
- **p3-u06-discover-tool.AC1.2 Success:** `query` parameter is required (string)
- **p3-u06-discover-tool.AC1.3 Success:** `topK` parameter is optional, integer, 1-20, defaults to 5

### p3-u06-discover-tool.AC2: Search and result formatting

- **p3-u06-discover-tool.AC2.1 Success:** `vectorStore.search(query, topK)` is called with both parameters from input
- **p3-u06-discover-tool.AC2.2 Success:** Each result includes recipe name with similarity as integer percentage (e.g., `92% match`)
- **p3-u06-discover-tool.AC2.3 Success:** Categories are resolved via `ctx.store.resolveCategories()` and displayed when present
- **p3-u06-discover-tool.AC2.4 Success:** `prepTime` and `cookTime` are displayed when present, omitted when null
- **p3-u06-discover-tool.AC2.5 Success:** Each result includes `UID: \`{uid}\``

### p3-u06-discover-tool.AC3: Empty and filtered results

- **p3-u06-discover-tool.AC3.1 Edge:** `search()` returns empty array → tool returns "No recipes found matching that description."
- **p3-u06-discover-tool.AC3.2 Edge:** All results map to deleted recipes (`store.get()` returns `undefined`) → tool returns "No recipes found matching that description."

### p3-u06-discover-tool.AC4: Deleted recipe handling

- **p3-u06-discover-tool.AC4.1 Success:** Results where `ctx.store.get(uid)` returns `undefined` are silently skipped
- **p3-u06-discover-tool.AC4.2 Success:** Remaining results are re-numbered sequentially (no gaps)

### p3-u06-discover-tool.AC5: Cold-start guard

- **p3-u06-discover-tool.AC5.1 Success:** When `ctx.store.size === 0`, tool returns the cold-start message without calling `vectorStore.search()`

---

## Phase 1: Tool Registration and Result Formatting

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Implement `registerDiscoverTool`

**Verifies:** p3-u06-discover-tool.AC1.1, p3-u06-discover-tool.AC1.2, p3-u06-discover-tool.AC1.3, p3-u06-discover-tool.AC2.1, p3-u06-discover-tool.AC2.2, p3-u06-discover-tool.AC2.3, p3-u06-discover-tool.AC2.4, p3-u06-discover-tool.AC2.5, p3-u06-discover-tool.AC3.1, p3-u06-discover-tool.AC3.2, p3-u06-discover-tool.AC4.1, p3-u06-discover-tool.AC4.2, p3-u06-discover-tool.AC5.1

**Files:**

- Create: `src/tools/discover.ts`

**Implementation:**

Create `src/tools/discover.ts` following the exact registration pattern from `src/tools/search.ts`.

**Function signature:**

```typescript
export function registerDiscoverTool(server: McpServer, ctx: ServerContext, vectorStore: VectorStore): void;
```

The third `vectorStore` parameter is additive — the caller decides whether to register this tool based on embedding configuration (P3-U08 concern).

**Imports needed:**

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { coldStartGuard, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";
import type { VectorStore } from "../features/vector-store.js";
```

Note: `VectorStore` is imported as `import type` since the tool only uses it as a dependency — no runtime import of the module itself is needed.

**Input schema** (flat Zod fields, matching the pattern in `src/tools/search.ts:14-24`):

```typescript
inputSchema: {
  query: z.string().describe("Natural language description of what you're looking for"),
  topK: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(5)
    .describe("Maximum number of results to return (default: 5, max: 20)"),
},
```

**Handler logic** (inside the `async (args) =>` callback):

1. Apply cold-start guard using `coldStartGuard(ctx).match()` — idiomatic neverthrow `.match()`, never `.isOk()`/`.isErr()`. Follow the exact pattern from `src/tools/search.ts:27-40`.

2. Inside the success branch of `.match()`:
   - Call `const results = await vectorStore.search(args.query, args.topK)` — passes both parameters from input.
   - If `results.length === 0`, return `textResult("No recipes found matching that description.")`.
   - For each result, look up the recipe via `ctx.store.get(result.uid as RecipeUid)`. If `undefined`, skip it (deleted recipe).
   - If all results were skipped (enriched list is empty), return `textResult("No recipes found matching that description.")`.
   - Format each enriched result as a numbered markdown entry using a `formatDiscoverHit` helper (see below).
   - Return `textResult(lines.join("\n\n"))`.

3. The error branch of `.match()` returns the guard payload: `(guard) => guard`.

**`RecipeUid` casting:** `result.uid` from `SemanticResult` is typed as `string`. Cast it to `RecipeUid` when calling `ctx.store.get()`:

```typescript
import type { RecipeUid } from "../paprika/types.js";
// ...
const recipe = ctx.store.get(result.uid as RecipeUid);
```

**Result formatting helper** (private function in same file):

```typescript
function formatDiscoverHit(index: number, recipe: Recipe, score: number, categoryNames: Array<string>): string {
  const percentage = Math.round(score * 100);
  const lines: Array<string> = [];
  lines.push(`${String(index)}. **${recipe.name}** — ${String(percentage)}% match`);
  if (categoryNames.length > 0) {
    lines.push(`   **Categories:** ${categoryNames.join(", ")}`);
  }
  const timeParts: Array<string> = [];
  if (recipe.prepTime) timeParts.push(`Prep: ${recipe.prepTime}`);
  if (recipe.cookTime) timeParts.push(`Cook: ${recipe.cookTime}`);
  if (timeParts.length > 0) {
    lines.push(`   ${timeParts.join(" · ")}`);
  }
  lines.push(`   UID: \`${recipe.uid}\``);
  return lines.join("\n");
}
```

Key details:

- `index` is the sequential 1-based number (re-numbered after filtering deleted recipes).
- `score` is converted to integer percentage via `Math.round(score * 100)`.
- Categories resolved via `ctx.store.resolveCategories(recipe.categories)` in the handler before calling this helper.
- `prepTime` and `cookTime` displayed only when non-null — matching the AC requirement. Note: the design specifies `prepTime` and `cookTime` (not `totalTime`), unlike `search.ts` which shows `prepTime` and `totalTime`.
- UID uses backtick-wrapped inline code format.

**Recipe type import:** `import type { Recipe, RecipeUid } from "../paprika/types.js";`

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm lint`
Expected: No lint warnings

**Commit:** `feat(discover): add registerDiscoverTool with semantic search and result formatting`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Unit tests for `registerDiscoverTool`

**Verifies:** p3-u06-discover-tool.AC1.1, p3-u06-discover-tool.AC1.2, p3-u06-discover-tool.AC1.3, p3-u06-discover-tool.AC2.1, p3-u06-discover-tool.AC2.2, p3-u06-discover-tool.AC2.3, p3-u06-discover-tool.AC2.4, p3-u06-discover-tool.AC2.5, p3-u06-discover-tool.AC3.1, p3-u06-discover-tool.AC3.2, p3-u06-discover-tool.AC4.1, p3-u06-discover-tool.AC4.2, p3-u06-discover-tool.AC5.1

**Files:**

- Create: `src/tools/discover.test.ts`

**Testing:**

Use the established tool testing pattern from `src/tools/search.test.ts` and `src/tools/tool-test-utils.ts`:

- `makeTestServer()` for the stub MCP server
- `makeCtx(store, server)` for the server context
- `getText(result)` to extract text from `CallToolResult`
- `makeRecipe()` and `makeCategory()` from `src/cache/__fixtures__/recipes.ts`
- `RecipeStore` from `src/cache/recipe-store.ts` loaded with test data

**VectorStore mock:** Create a mock object implementing the `search` method:

```typescript
import type { VectorStore, SemanticResult } from "../features/vector-store.js";

function makeMockVectorStore(results: ReadonlyArray<SemanticResult> = []): { search: ReturnType<typeof vi.fn> } {
  return {
    search: vi.fn<(query: string, topK: number) => Promise<ReadonlyArray<SemanticResult>>>().mockResolvedValue(results),
  };
}
```

Cast this to `VectorStore` when passing to `registerDiscoverTool`:

```typescript
registerDiscoverTool(server, ctx, mockVs as unknown as VectorStore);
```

**Test structure** follows the AC naming convention from `src/tools/search.test.ts`:

```typescript
describe("p3-u06-discover-tool: discover_recipes tool", () => {
  describe("p3-u06-discover-tool.AC1: Tool registration and input schema", () => { ... });
  describe("p3-u06-discover-tool.AC2: Search and result formatting", () => { ... });
  describe("p3-u06-discover-tool.AC3: Empty and filtered results", () => { ... });
  describe("p3-u06-discover-tool.AC4: Deleted recipe handling", () => { ... });
  describe("p3-u06-discover-tool.AC5: Cold-start guard", () => { ... });
});
```

**Tests to write for each AC:**

- **p3-u06-discover-tool.AC1.1:** Register the tool, call it — should not throw "Tool not registered"
- **p3-u06-discover-tool.AC1.2:** Call with `query` string — tool executes successfully. (Implicitly tested by all other tests.)
- **p3-u06-discover-tool.AC1.3:** Call without `topK` — verify `vectorStore.search` was called with `topK = 5` (the default). Call with `topK = 10` — verify it was called with `10`.

- **p3-u06-discover-tool.AC2.1:** Set up mock `vectorStore.search` returning results, call tool — verify `search` was called with the query string and topK value from args.
- **p3-u06-discover-tool.AC2.2:** Mock returns `[{ uid, score: 0.923, recipeName }]`, load matching recipe in store — output contains `92% match` (integer percentage).
- **p3-u06-discover-tool.AC2.3:** Load recipe with categories, mock returns matching UID — output contains category names.
- **p3-u06-discover-tool.AC2.4:** Load recipe with `prepTime: "10 min"` and `cookTime: "30 min"` — output contains both. Load recipe with `prepTime: null, cookTime: null` — output contains neither time string.
- **p3-u06-discover-tool.AC2.5:** Output contains `` UID: `recipe-uid` `` for each result.

- **p3-u06-discover-tool.AC3.1:** Mock `search` returns empty array — output is "No recipes found matching that description."
- **p3-u06-discover-tool.AC3.2:** Mock `search` returns results, but all UIDs map to recipes not in store (`store.get()` returns `undefined`) — output is "No recipes found matching that description."

- **p3-u06-discover-tool.AC4.1:** Mock returns 3 results, middle one not in store — output contains only 2 results.
- **p3-u06-discover-tool.AC4.2:** Same setup as AC4.1 — verify results are numbered `1.` and `2.` (sequential, no gap at `2.`).

- **p3-u06-discover-tool.AC5.1:** Empty store (not loaded, `size === 0`) — output contains cold-start message ("try again"), and `vectorStore.search` was NOT called (verify via `expect(mockVs.search).not.toHaveBeenCalled()`).

**Verification:**

Run: `pnpm test src/tools/discover.test.ts`
Expected: All tests pass

Run: `pnpm test`
Expected: Full test suite passes

**Commit:** `test(discover): add unit tests for discover_recipes tool`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
