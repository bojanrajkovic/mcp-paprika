# Recipe CRUD — Phase 1: Shared Helpers and Test Utilities

**Goal:** Add `commitRecipe` and `resolveCategoryNames` to `helpers.ts`, and extend `makeCtx` in `tool-test-utils.ts` with an optional `overrides` parameter so write-tool tests can inject mock client and cache objects.

**Architecture:** Both helpers extend existing files. `resolveCategoryNames` is a pure function (Functional Core). `commitRecipe` coordinates I/O (Imperative Shell). The `makeCtx` extension is backward-compatible: all existing read-tool tests continue to pass without changes.

**Tech Stack:** TypeScript 5.9, ESM, neverthrow, Vitest

**Scope:** Phase 1 of 5 — prerequisite for all write tools

**Codebase verified:** 2026-03-14

---

## Acceptance Criteria Coverage

**Verifies: None** — this is an infrastructure/prerequisite phase. Verification is operational: `pnpm build` succeeds and all existing tests continue to pass unchanged.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->

### Task 1: Add `commitRecipe` and `resolveCategoryNames` to `src/tools/helpers.ts`

**Files:**

- Modify: `src/tools/helpers.ts`

**Implementation:**

Add two imports to the existing import block at the top of `src/tools/helpers.ts`. The file already imports `Recipe` and `ServerContext`; add `Category` and `CategoryUid` from the same types file:

```typescript
import type { Category, CategoryUid, Recipe } from "../paprika/types.js";
```

Then append the two new exported functions **after** the existing `recipeToMarkdown` function:

```typescript
/**
 * Persists a saved recipe to the local cache and store, then triggers cloud sync.
 * Called by all write tools after ctx.client.saveRecipe() returns.
 *
 * Order: putRecipe (sync) → flush (async) → store.set (sync) → notifySync (async)
 * Do NOT call ctx.client.notifySync() separately in the tool handler — commitRecipe
 * already calls it.
 */
export async function commitRecipe(ctx: ServerContext, saved: Recipe): Promise<void> {
  ctx.cache.putRecipe(saved, saved.hash); // sync — buffers to memory
  await ctx.cache.flush(); // async — writes pending entries to disk
  ctx.store.set(saved); // sync — updates in-process store
  await ctx.client.notifySync(); // async — signals Paprika cloud to propagate
}

/**
 * Resolves human-readable category display names to CategoryUid values.
 * Case-insensitive linear scan of all known categories.
 *
 * @returns uids — matched UIDs in the same order as input names
 *          unknown — names that had no matching category (caller should warn)
 */
export function resolveCategoryNames(
  all: Array<Category>,
  names: Array<string>,
): { uids: Array<CategoryUid>; unknown: Array<string> } {
  const uids: Array<CategoryUid> = [];
  const unknown: Array<string> = [];
  for (const name of names) {
    const lower = name.toLowerCase();
    const match = all.find((c) => c.name.toLowerCase() === lower);
    if (match) {
      uids.push(match.uid);
    } else {
      unknown.push(name);
    }
  }
  return { uids, unknown };
}
```

**Key points:**

- `ctx.cache.putRecipe()` is **synchronous** — do not `await` it
- `ctx.cache.flush()` is **async** — must be awaited before `store.set`
- `resolveCategoryNames` is pure (no I/O, same input → same output)
- `Category.uid` is already typed as `CategoryUid` (branded), so `match.uid` satisfies the return type without casting

**Verification:**

```bash
pnpm typecheck
```

Expected: no errors.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Extend `makeCtx` in `src/tools/tool-test-utils.ts`

**Files:**

- Modify: `src/tools/tool-test-utils.ts` (lines 28–35)

**Implementation:**

Replace the existing `makeCtx` function with the following. The change is strictly additive — only the function signature gains a third parameter with a default value, so all existing call sites continue to compile without changes:

```typescript
/**
 * Creates a minimal ServerContext for tool unit tests.
 *
 * @param store   — real RecipeStore populated by tests
 * @param server  — stub McpServer from makeTestServer()
 * @param overrides — optional partial overrides for client and/or cache.
 *   Write-tool tests inject { saveRecipe: vi.fn(), notifySync: vi.fn() } and
 *   { putRecipe: vi.fn(), flush: vi.fn() } here.
 *   Read-tool tests pass no overrides — the existing stubs suffice.
 */
export function makeCtx(
  store: RecipeStore,
  server: McpServer,
  overrides: Partial<Pick<ServerContext, "client" | "cache">> = {},
): ServerContext {
  return {
    store,
    server,
    client: {} as unknown as ServerContext["client"],
    cache: {} as unknown as ServerContext["cache"],
    ...overrides,
  } satisfies ServerContext;
}
```

**Key points:**

- `overrides` defaults to `{}` — no call-site changes needed for existing tests
- Spread `...overrides` at the end means injected mocks override the stubs
- Existing tests call `makeCtx(store, server)` — TypeScript allows the missing third arg because it has a default

**Verification:**

```bash
pnpm typecheck
pnpm test
```

Expected: build succeeds, all existing tests pass (no regressions in `search.test.ts`, `filter.test.ts`, `categories.test.ts`, `helpers.test.ts`, `helpers.property.test.ts`).

<!-- END_TASK_2 -->

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Add direct unit tests for `resolveCategoryNames` and `commitRecipe` to `src/tools/helpers.test.ts`

**Files:**

- Modify: `src/tools/helpers.test.ts` (append new `describe` blocks)

**Testing:**

Append two new `describe` blocks to the existing `helpers.test.ts` file after the `recipeToMarkdown` suite.

**`resolveCategoryNames` tests** — pure function, no mocks needed. Use `makeCategory()` fixtures:

Tests must verify:

- **p2-recipe-crud.AC-helpers.1:** Exact name match (case-sensitive) returns the category's UID in `uids` and an empty `unknown` array
- **p2-recipe-crud.AC-helpers.2:** Case-insensitive match (`"desserts"` matches `"Desserts"`) returns the UID, not in `unknown`
- **p2-recipe-crud.AC-helpers.3:** Unrecognized name appears in `unknown`, not in `uids`
- **p2-recipe-crud.AC-helpers.4:** Mix of known and unknown names — known go to `uids`, unknown go to `unknown`, both in input order
- **p2-recipe-crud.AC-helpers.5:** Empty `names` array returns `{ uids: [], unknown: [] }`
- **p2-recipe-crud.AC-helpers.6:** Empty `all` categories array with non-empty `names` returns all names in `unknown`

**`commitRecipe` tests** — uses vi.fn() mocks. The function is Imperative Shell (has side effects), so test it with mocks to verify call order and arguments:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { DiskCache } from "../cache/disk-cache.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { ServerContext } from "../types/server-context.js";
import { commitRecipe } from "./helpers.js";

// Inside describe("commitRecipe"):
const mockPutRecipe = vi.fn();
const mockFlush = vi.fn().mockResolvedValue(undefined);
const mockNotifySync = vi.fn().mockResolvedValue(undefined);
const mockStoreSet = vi.fn();

const ctx = {
  cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
  client: { notifySync: mockNotifySync } as unknown as PaprikaClient,
  store: { set: mockStoreSet } as unknown as ServerContext["store"],
  server: {} as unknown as ServerContext["server"],
} satisfies ServerContext;
```

Tests must verify:

- **p2-recipe-crud.AC-helpers.7:** `commitRecipe` calls `putRecipe(saved, saved.hash)`, `flush()`, `store.set(saved)`, and `notifySync()` — all four called exactly once
- **p2-recipe-crud.AC-helpers.8:** `putRecipe` is called synchronously before `flush` — verify using call order tracking (e.g., `const callOrder: Array<string> = []`; push to it in each mock implementation; assert order after await)
- **p2-recipe-crud.AC-helpers.9:** `store.set` is called with the `saved` recipe (not the original pre-save recipe)

**Import additions** for the test file:

```typescript
import { describe, it, expect, vi } from "vitest";
import { makeCategory } from "../cache/__fixtures__/recipes.js";
import { commitRecipe, resolveCategoryNames } from "./helpers.js";
import type { DiskCache } from "../cache/disk-cache.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { ServerContext } from "../types/server-context.js";
```

**Verification:**

```bash
pnpm test src/tools/helpers.test.ts
```

Expected: all new tests pass alongside existing `textResult`, `coldStartGuard`, and `recipeToMarkdown` tests.

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Commit

```bash
git add src/tools/helpers.ts src/tools/tool-test-utils.ts src/tools/helpers.test.ts
git commit -m "feat(tools): add commitRecipe and resolveCategoryNames helpers, extend makeCtx"
```

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_A -->
