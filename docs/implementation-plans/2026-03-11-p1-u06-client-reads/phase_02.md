# PaprikaClient Read Operations Implementation Plan — Phase 2

**Goal:** Add `getRecipes()` and `listCategories()` batch read methods to `PaprikaClient`, each with an independent Cockatiel `bulkhead(5)` semaphore to limit concurrent in-flight requests.

**Architecture:** `getRecipes()` fans out to `getRecipe()` via `Promise.all`, each call gated by `_recipesBulkhead.execute()`. `listCategories()` first fetches a `CategoryEntry[]` list, then fans out to per-category `request()` calls gated by `_categoriesBulkhead.execute()`. The two bulkheads are separate instances so a large recipe batch cannot block category hydration. Failure semantics: `Promise.all` means one failure rejects the entire batch.

**Tech Stack:** TypeScript 5.9 (strict), Cockatiel `bulkhead` v3.2.1, Zod, Vitest, MSW v2

**Scope:** Phase 2 of 2 from original design (phases 2–2). Depends on Phase 1 being complete (`getRecipe()` must exist).

**Codebase verified:** 2026-03-11

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p1-u06-client-reads.AC3: getRecipes() fetches multiple recipes with concurrency limiting

- **p1-u06-client-reads.AC3.1 Success:** Returns `Recipe[]` with one entry per provided UID, in the same order
- **p1-u06-client-reads.AC3.2 Edge:** `getRecipes([])` returns `[]` with zero HTTP requests made
- **p1-u06-client-reads.AC3.3 Concurrency:** At most 5 `getRecipe()` calls execute simultaneously (bulkhead cap)
- **p1-u06-client-reads.AC3.4 Failure:** A single recipe fetch error causes the entire `getRecipes()` call to reject

### p1-u06-client-reads.AC4: listCategories() returns hydrated Category objects

- **p1-u06-client-reads.AC4.1 Success:** Returns `Category[]` with all fields in camelCase (not raw `CategoryEntry[]`)
- **p1-u06-client-reads.AC4.2 Step:** Makes exactly one request to `/api/v2/sync/categories/` then N requests to `/api/v2/sync/category/{uid}/`
- **p1-u06-client-reads.AC4.3 Edge:** Returns `[]` when `/categories/` returns an empty list, with no hydration requests made
- **p1-u06-client-reads.AC4.4 Concurrency:** At most 5 hydration requests execute simultaneously, independently of the recipe bulkhead

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Implement getRecipes() and listCategories() in client.ts

**Verifies:** p1-u06-client-reads.AC3.1, p1-u06-client-reads.AC3.2, p1-u06-client-reads.AC4.1, p1-u06-client-reads.AC4.2, p1-u06-client-reads.AC4.3

**Files:**

- Modify: `src/paprika/client.ts`

**Prerequisites:** Phase 1 must be complete. `listRecipes()` and `getRecipe()` must exist on `PaprikaClient`, and the `@ts-expect-error` stubs must be removed.

**Implementation — two edits to `src/paprika/client.ts`:**

**Edit 1 — Add `bulkhead` to the cockatiel import.**

Current (lines 11–19):

```typescript
import {
  ExponentialBackoff,
  ConsecutiveBreaker,
  retry,
  circuitBreaker,
  handleType,
  wrap,
  BrokenCircuitError,
} from "cockatiel";
```

Replace with (add `bulkhead` to the list):

```typescript
import {
  ExponentialBackoff,
  ConsecutiveBreaker,
  bulkhead,
  retry,
  circuitBreaker,
  handleType,
  wrap,
  BrokenCircuitError,
} from "cockatiel";
```

Also extend the `./types.js` imports (Phase 1 will have split these already) to include the Category schemas and types. The import from `./types.js` after Phase 1 looks like:

```typescript
import type { Recipe, RecipeEntry } from "./types.js";
import { AuthResponseSchema, RecipeEntrySchema, RecipeSchema } from "./types.js";
```

Replace with:

```typescript
import type { Category, CategoryEntry, Recipe, RecipeEntry } from "./types.js";
import { AuthResponseSchema, CategoryEntrySchema, CategorySchema, RecipeEntrySchema, RecipeSchema } from "./types.js";
```

**Edit 2 — Add two private bulkhead fields and two public methods inside `PaprikaClient`.**

Add the two private instance fields immediately after the `private token: string | null = null;` line:

```typescript
  private readonly _recipesBulkhead = bulkhead(5, Number.MAX_SAFE_INTEGER);
  private readonly _categoriesBulkhead = bulkhead(5, Number.MAX_SAFE_INTEGER);
```

Then add the two public batch methods after `getRecipe()` (and before the private `request<T>()`):

```typescript
  async getRecipes(uids: ReadonlyArray<string>): Promise<Array<Recipe>> {
    return Promise.all(
      uids.map((uid) => this._recipesBulkhead.execute(() => this.getRecipe(uid))),
    );
  }

  async listCategories(): Promise<Array<Category>> {
    const entries = await this.request(
      "GET",
      `${API_BASE}/categories/`,
      z.array(CategoryEntrySchema),
    );
    return Promise.all(
      entries.map((entry) =>
        this._categoriesBulkhead.execute(() =>
          this.request("GET", `${API_BASE}/category/${entry.uid}/`, CategorySchema),
        ),
      ),
    );
  }
```

**Note on `getRecipes` parameter type:** The house style uses `Array<T>` / `ReadonlyArray<T>` rather than `T[]`. Use `ReadonlyArray<string>` for the input parameter since the method does not mutate the array.

**Verification:**

Run: `pnpm typecheck`
Expected: Exits with code 0. No TypeScript errors.

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Tests for getRecipes() and listCategories()

**Verifies:** p1-u06-client-reads.AC3.1, p1-u06-client-reads.AC3.2, p1-u06-client-reads.AC3.3, p1-u06-client-reads.AC3.4, p1-u06-client-reads.AC4.1, p1-u06-client-reads.AC4.2, p1-u06-client-reads.AC4.3, p1-u06-client-reads.AC4.4

**Files:**

- Modify: `src/paprika/client.test.ts`

**Current state:** Phase 1 has added `PaprikaAPIError` to the errors import and defined `const API_BASE = "https://paprikaapp.com/api/v2/sync"`. Do not duplicate these.

**Implementation — add two new `describe` blocks** inside the outer `describe("PaprikaClient", ...)` block, after the Phase 1 `AC2` block.

---

**Helper note:** `makeSnakeCaseRecipe(uid: string)` was introduced in Phase 1 Task 2. It is already present in `src/paprika/client.test.ts`. Do not add it again.

---

**Block 1 — getRecipes() tests:**

```typescript
describe("p1-u06-client-reads.AC3: getRecipes() fetches multiple recipes with concurrency limiting", () => {
```

- **`it("p1-u06-client-reads.AC3.1 - ...")`** (batch success):
  Register an `http.get(`${API_BASE}/recipe/:uid/`, ...)` handler that returns `HttpResponse.json({ result: makeSnakeCaseRecipe(params.uid) })`. Call `await client.getRecipes(["uid-1", "uid-2", "uid-3"])`. Assert the returned array has length 3, each element has the correct `name` field matching the UID (e.g., `"Recipe uid-1"`), and order is preserved (index 0 = `"uid-1"`, index 1 = `"uid-2"`, index 2 = `"uid-3"`).

  Note: MSW route params are accessed via `params.uid` in the handler. Since the handler URL uses `:uid` as a path param, MSW will extract it.

- **`it("p1-u06-client-reads.AC3.2 - ...")`** (empty input):
  Do NOT register any MSW handler. Call `await client.getRecipes([])`. Assert the returned value is `[]`. No HTTP requests should be made (the MSW server would return 500 for unmatched routes, so if a request is made the test would fail automatically).

- **`it("p1-u06-client-reads.AC3.3 - ...")`** (concurrency cap):
  Use a shared `inFlight` counter to track simultaneously in-progress requests. Register an `http.get(`${API_BASE}/recipe/:uid/`, ...)` handler that:
  1. Increments `inFlight` and updates a `peakInFlight` tracker
  2. Awaits a short delay (`await new Promise(resolve => setTimeout(resolve, 20))`)
  3. Decrements `inFlight`
  4. Returns `HttpResponse.json({ result: makeSnakeCaseRecipe(params.uid) })`

  Create 10 UIDs and call `await client.getRecipes(uids)`. After the call completes, assert `peakInFlight <= 5`.

  ```typescript
  let inFlight = 0;
  let peakInFlight = 0;

  server.use(
    http.get(`${API_BASE}/recipe/:uid/`, async ({ params }) => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight--;
      return HttpResponse.json({ result: makeSnakeCaseRecipe(params.uid as string) });
    }),
  );

  const uids = Array.from({ length: 10 }, (_, i) => `uid-${i.toString()}`);
  await client.getRecipes(uids);

  expect(peakInFlight).toBeLessThanOrEqual(5);
  ```

- **`it("p1-u06-client-reads.AC3.4 - ...")`** (single failure rejects batch):
  Register two handlers: one for `/recipe/good-uid/` returning a valid recipe, one for `/recipe/bad-uid/` returning `HttpResponse.json({}, { status: 404 })`. Use HTTP 404 (not 500) — 404 is not in `RETRYABLE_STATUSES` so it fails immediately without retrying. Call `client.getRecipes(["good-uid", "bad-uid"])` and assert it rejects with `PaprikaAPIError`. Use try/catch:
  ```typescript
  try {
    await client.getRecipes(["good-uid", "bad-uid"]);
    expect.fail("Should have thrown");
  } catch (error) {
    expect(error).toBeInstanceOf(PaprikaAPIError);
  }
  ```

---

**Block 2 — listCategories() tests:**

```typescript
describe("p1-u06-client-reads.AC4: listCategories() returns hydrated Category objects", () => {
```

- **`it("p1-u06-client-reads.AC4.1 - ...")`** (camelCase output):
  Register two handlers:
  1. `http.get(`${API_BASE}/categories/`, ...)` returning `HttpResponse.json({ result: [{ uid: "cat-1", hash: "h1" }] })`
  2. `http.get(`${API_BASE}/category/cat-1/`, ...)` returning `HttpResponse.json({ result: { uid: "cat-1", name: "Breakfast", order_flag: 1, parent_uid: null } })`

  Call `await client.listCategories()`. Assert the returned array has length 1 and the single element has camelCase fields: `orderFlag === 1` (not `order_flag`), `parentUid === null` (not `parent_uid`), `name === "Breakfast"`.

- **`it("p1-u06-client-reads.AC4.2 - ...")`** (two-step fetch):
  Track request counts for each endpoint. Register:
  1. Categories list handler (increments `listCount`)
  2. Per-category handler for two UIDs (increments `hydrateCount` each call)

  Register list handler returning two entries: `[{uid: "c1", hash: "h1"}, {uid: "c2", hash: "h2"}]`. Register hydration handlers for `c1` and `c2`. Call `listCategories()`. Assert `listCount === 1` and `hydrateCount === 2`.

- **`it("p1-u06-client-reads.AC4.3 - ...")`** (empty list — no hydration):
  Register a handler for `${API_BASE}/categories/` returning `HttpResponse.json({ result: [] })`. Do NOT register any hydration handler. Call `await client.listCategories()`. Assert the result is `[]`. MSW will 500 on any unmatched hydration request, so the test will fail automatically if any hydration is attempted.

- **`it("p1-u06-client-reads.AC4.4 - ...")`** (concurrency cap, independent of recipe bulkhead):
  Use the same in-flight counter pattern as AC3.3, but for the `${API_BASE}/category/:uid/` handler. Create 10 category entries, register the list handler returning all 10, register the hydration handler with a 20ms delay and in-flight tracking. Call `listCategories()`. Assert `peakInFlight <= 5`.

  Additionally, to verify the category bulkhead is independent of the recipe bulkhead, start a concurrent `getRecipes()` call at the same time and verify neither blocks the other from completing. Simple approach: call both concurrently and verify both resolve, asserting category peak stays `<= 5` and recipe peak stays `<= 5` independently.

---

**Verification:**

Run: `pnpm test`
Expected: All tests pass. The 8 new tests (AC3.1–AC3.4, AC4.1–AC4.4) show as green.

**Commit:**

```bash
git add src/paprika/client.ts src/paprika/client.test.ts
git commit -m "feat(paprika): add getRecipes() and listCategories() with bulkhead concurrency limiting"
```

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

---

## Final Verification

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: All three commands exit with code 0.
