# Recipe CRUD — Phase 3: `delete_recipe` Tool

**Goal:** Implement the `delete_recipe` MCP tool. Accepts a UID (no fuzzy title matching — deletion is destructive). Fetches the recipe from the local store, sets `inTrash: true`, calls `ctx.client.saveRecipe()`, then commits to local state via `commitRecipe`. Returns a confirmation message.

**Architecture:** UID-only to prevent accidental deletion via fuzzy matching. Uses `commitRecipe` helper from Phase 1 to update cache, store, and trigger sync in one call. Checks `recipe.inTrash` before calling the API to provide a clear "already in trash" message.

**Tech Stack:** TypeScript 5.9, @modelcontextprotocol/sdk, zod, neverthrow, Vitest + vi.fn() mocks

**Scope:** Phase 3 of 5 — depends on Phase 1 (commitRecipe helper)

**Codebase verified:** 2026-03-14

---

## Acceptance Criteria Coverage

### p2-recipe-crud.AC4: delete_recipe soft-deletes by UID

- **p2-recipe-crud.AC4.1 Success:** Recipe is soft-deleted (inTrash: true) and confirmation returned
- **p2-recipe-crud.AC4.2 Success:** saveRecipe called with inTrash: true, notifySync called once
- **p2-recipe-crud.AC4.3 Success:** store.set and cache.putRecipe called with the trashed recipe
- **p2-recipe-crud.AC4.4 Failure:** UID not found returns not-found message
- **p2-recipe-crud.AC4.5 Failure:** Recipe already in trash returns 'already in trash' message
- **p2-recipe-crud.AC4.6 Failure:** saveRecipe throws — returns error message
- **p2-recipe-crud.AC4.7 Failure:** Cold-start guard fires before store lookup

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->

### Task 1: Create `src/tools/delete.ts`

**Files:**

- Create: `src/tools/delete.ts`

**Implementation:**

```typescript
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeUidSchema } from "../paprika/types.js";
import { coldStartGuard, commitRecipe, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerDeleteTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "delete_recipe",
    {
      description:
        "Soft-delete a recipe by UID, moving it to the Paprika trash. " +
        "This operation is reversible — trashed recipes can be recovered in the Paprika app. " +
        "Requires an exact UID; fuzzy title matching is not supported to prevent accidental deletion.",
      inputSchema: {
        uid: z.string().describe("Recipe UID to delete"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = RecipeUidSchema.parse(args.uid);
          const recipe = ctx.store.get(uid);

          if (!recipe) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          if (recipe.inTrash) {
            return textResult(`Recipe "${recipe.name}" is already in the trash.`);
          }

          const trashed = { ...recipe, inTrash: true };

          try {
            const saved = await ctx.client.saveRecipe(trashed);
            await commitRecipe(ctx, saved);
          } catch (error) {
            return textResult(`Failed to delete recipe: ${error instanceof Error ? error.message : String(error)}`);
          }

          return textResult(`Recipe "${recipe.name}" has been moved to the trash.`);
        },
        (guard) => guard,
      );
    },
  );
}
```

**Key points:**

- `{ ...recipe, inTrash: true }` creates a new object satisfying `Readonly<Recipe>` (the type `saveRecipe` expects)
- The `inTrash` guard before the API call prevents a redundant network round-trip and gives a meaningful message
- `commitRecipe` calls `notifySync` — do not call `ctx.client.notifySync()` separately
- The `try/catch` wraps both `saveRecipe` and `commitRecipe` since either can throw

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Create `src/tools/delete.test.ts`

**Files:**

- Create: `src/tools/delete.test.ts`

**Testing:**

Write-tool tests require mock injection via the `overrides` parameter added to `makeCtx` in Phase 1. This is the first use of that pattern — establish it clearly here.

**Mock setup pattern (use for every write-tool test that exercises the happy path):**

```typescript
import { describe, it, expect, vi } from "vitest";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";

// Inside each test (or shared in beforeEach):
const mockSaveRecipe = vi.fn();
const mockNotifySync = vi.fn().mockResolvedValue(undefined);
const mockPutRecipe = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);

const ctx = makeCtx(store, server, {
  client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
  cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
});
```

For happy-path tests, `mockSaveRecipe` should return the trashed recipe:

```typescript
const trashed = { ...recipe, inTrash: true };
mockSaveRecipe.mockResolvedValue(trashed);
```

Tests must verify:

- **p2-recipe-crud.AC4.1:** Call `callTool("delete_recipe", { uid: recipe.uid })`. Result text contains the recipe name and "trash" (confirmation message). The recipe in the store must have `inTrash: true` (check `store.get(recipe.uid)?.inTrash`). Note: `store.get()` returns trashed recipes; `store.getAll()` excludes them.

- **p2-recipe-crud.AC4.2:** After a successful delete, assert `mockSaveRecipe` was called with an argument where `inTrash === true`. Assert `mockNotifySync` was called exactly once (called via `commitRecipe`). Use `expect(mockSaveRecipe.mock.calls[0]?.[0]).toMatchObject({ inTrash: true })` and `expect(mockNotifySync).toHaveBeenCalledOnce()`.

- **p2-recipe-crud.AC4.3:** After a successful delete, assert `mockPutRecipe` was called with the saved recipe as the first argument. Assert `mockFlush` was called once. The `store.set` call is verified via `store.get(uid)?.inTrash === true` (store.set is not mockable since it's a real RecipeStore).

- **p2-recipe-crud.AC4.4:** Call with `{ uid: "nonexistent-uid" }`. Mock saveRecipe should not be configured (not called). Result text contains "not found" (case-insensitive). Assert `mockSaveRecipe` was not called.

- **p2-recipe-crud.AC4.5:** Load **both** a non-trashed recipe (so `store.size > 0`, passing the cold-start guard) and a trashed recipe into the store: `store.load([makeRecipe(), makeRecipe({ inTrash: true })], [])`. Call with the trashed recipe's UID. Result text contains "already in the trash". Assert `mockSaveRecipe` was not called. (Note: `store.size` only counts non-trashed recipes, so loading only a trashed recipe would trigger the cold-start guard instead of reaching the in-trash check.)

- **p2-recipe-crud.AC4.6:** Configure `mockSaveRecipe.mockRejectedValue(new Error("API timeout"))`. Call `callTool`. Result text contains "Failed to delete" and "API timeout". Assert `mockPutRecipe` was not called (store/cache not updated on error).

- **p2-recipe-crud.AC4.7:** Use an empty `RecipeStore` (not loaded). Call with any UID. Result text contains "try again" (cold-start guard).

**Import pattern:**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { registerDeleteTool } from "./delete.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";
```

**Store setup note:** The store must have `size > 0` for the cold-start guard to pass. Load at least one recipe with `store.load([recipe], [])`. For AC4.7, leave the store empty.

**Verification:**

```bash
pnpm test src/tools/delete.test.ts
```

Expected: all 7+ tests pass.

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Commit

```bash
git add src/tools/delete.ts src/tools/delete.test.ts
git commit -m "feat(tools): add delete_recipe tool with soft-delete via inTrash flag (p2-recipe-crud AC4)"
```

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
