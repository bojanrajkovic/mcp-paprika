# PaprikaClient Write Operations — Phase 2: `notifySync` and `deleteRecipe`

**Goal:** Add sync propagation (`notifySync`) and soft-delete (`deleteRecipe`) to `PaprikaClient`.

**Architecture:** `notifySync` is a thin POST to `/api/v2/sync/notify/` using `z.unknown()` that discards
the response. `deleteRecipe` orchestrates three sequential calls: `getRecipe` → `saveRecipe` (with
`inTrash: true`) → `notifySync`. Both route through the existing `request<T>()` helper, inheriting
retry, circuit-breaker, and 401 re-auth for free.

**Tech Stack:** Zod `z.unknown()` for the uninteresting notify response, MSW `msw/node` for test
interception of multi-request chains, Vitest.

**Scope:** 2 phases from original design (phase 2 of 2)

**Codebase verified:** 2026-03-12

**Dependencies:** Requires Phase 1 (`saveRecipe`, `buildRecipeFormData`, `recipeToApiPayload`) to be
complete before this phase begins.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### p1-u07-client-writes.AC2: deleteRecipe soft-deletes via trash flag

- **p1-u07-client-writes.AC2.1 Success:** GETs current recipe, then POSTs back with `in_trash: true` in the payload
- **p1-u07-client-writes.AC2.2 Success:** After saveRecipe, POSTs to `/api/v2/sync/notify/` (notifySync is called)
- **p1-u07-client-writes.AC2.3 Failure:** 404 from `getRecipe` throws `PaprikaAPIError` with no subsequent POST

### p1-u07-client-writes.AC3: notifySync propagates changes

- **p1-u07-client-writes.AC3.1 Success:** POSTs to `/api/v2/sync/notify/`
- **p1-u07-client-writes.AC3.2 Success:** Returns void (Promise resolves with no value)

### p1-u07-client-writes.AC4: TypeScript hygiene

- **p1-u07-client-writes.AC4.1:** `pnpm typecheck` exits 0 with no suppressions added
- **p1-u07-client-writes.AC4.2:** All three public methods have explicit return type annotations (`notifySync` and `deleteRecipe` covered here; `saveRecipe` covered in phase 1)

---

## Codebase State (Verified)

Before implementing, understand the state after Phase 1 completes:

- **`src/paprika/client.ts`** will already have `saveRecipe`, `buildRecipeFormData`, `recipeToApiPayload`, and the `gzipSync` import.
- The existing type import at line 23 is:
  ```typescript
  import type { Category, Recipe, RecipeEntry } from "./types.js";
  ```
  `RecipeUid` is **not** in this import — you must add it.
- `request<T>()` accepts `z.unknown()` as its schema parameter. `z` is already imported from `"zod"`.
- `getRecipe(uid: string)` exists at line 90. It takes a plain `string`, not a branded `RecipeUid`. Since `RecipeUid` is a branded string (extends `string` at runtime), you can pass it directly.
- `API_BASE = "https://paprikaapp.com/api/v2/sync"` — so the notify URL is `${API_BASE}/notify/`.
- **Test file** (`src/paprika/client.test.ts`) will already have the `gunzipSync` import and `RecipeSchema` import from Phase 1. The `makeSnakeCaseRecipe` helper exists.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Implement `notifySync`

**Verifies:** p1-u07-client-writes.AC4.1, p1-u07-client-writes.AC4.2 (notifySync return type)

**Files:**

- Modify: `src/paprika/client.ts`

**Implementation:**

**Step 1: Add `RecipeUid` to the type import**

Update the import at line 23 from:

```typescript
import type { Category, Recipe, RecipeEntry } from "./types.js";
```

to:

```typescript
import type { Category, Recipe, RecipeEntry, RecipeUid } from "./types.js";
```

**Step 2: Add `notifySync` public method**

Add inside `PaprikaClient`, after `saveRecipe` and before `buildRecipeFormData`. It must have an explicit return type annotation (`Promise<void>`):

```typescript
async notifySync(): Promise<void> {
  await this.request("POST", `${API_BASE}/notify/`, z.unknown());
}
```

- `z.unknown()` is used because the API returns `{ "result": {} }` — the content carries no meaningful payload and is discarded.
- `await` discards the `unknown` result; the method implicitly returns `undefined`, which satisfies `Promise<void>`.
- No `body` argument is passed — the notify endpoint requires only the POST method, no body.

**Step 3: Verify typecheck**

```bash
pnpm typecheck
```

Expected: exits 0.

**Step 4: Commit**

```bash
git add src/paprika/client.ts
git commit -m "feat(paprika): add notifySync method"
```

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: Tests for `notifySync`

**Verifies:** p1-u07-client-writes.AC3.1, p1-u07-client-writes.AC3.2

**Files:**

- Modify: `src/paprika/client.test.ts`

**Testing — what each test must verify:**

**p1-u07-client-writes.AC3.1** — POSTs to `/api/v2/sync/notify/`:

- Register an `http.post` handler at `` `${API_BASE}/notify/` `` that captures whether it was reached (boolean flag), returning `HttpResponse.json({ result: {} })`
- Call `client.notifySync()`
- Assert the handler was reached (the flag is `true`)

**p1-u07-client-writes.AC3.2** — Returns void:

- Call `client.notifySync()` and capture the result: `const result = await client.notifySync()`
- Assert `result` is `undefined` (in JavaScript/TypeScript, `void` functions return `undefined` at runtime)

Implementation notes:

- Both tests can share a single `describe("p1-u07-client-writes.AC3: notifySync propagates changes", ...)` block
- The handler must return `HttpResponse.json({ result: {} })` — MSW must intercept the request or it will return HTTP 500 and the test will fail with `PaprikaAPIError`
- Use the existing `const API_BASE = "https://paprikaapp.com/api/v2/sync"` constant already defined in the test file (line 9)

**Step 1: Run tests**

```bash
pnpm test
```

Expected: all existing tests still pass, plus the 2 new `notifySync` tests pass.

**Step 2: Commit**

```bash
git add src/paprika/client.test.ts
git commit -m "test(paprika): add notifySync tests covering AC3.1–AC3.2"
```

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->

### Task 3: Implement `deleteRecipe`

**Verifies:** p1-u07-client-writes.AC4.1, p1-u07-client-writes.AC4.2 (deleteRecipe return type)

**Files:**

- Modify: `src/paprika/client.ts`

**Implementation:**

Add `deleteRecipe` inside `PaprikaClient`, after `notifySync` and before `buildRecipeFormData`:

```typescript
async deleteRecipe(uid: RecipeUid): Promise<void> {
  const recipe = await this.getRecipe(uid);
  await this.saveRecipe({ ...recipe, inTrash: true });
  await this.notifySync();
}
```

Key details:

- `uid: RecipeUid` — the branded type is required per the design's public API contract. `RecipeUid` is now imported (from Task 1 in this phase).
- `this.getRecipe(uid)` — `getRecipe` takes `uid: string`; since `RecipeUid` is a branded string (structurally `string` at runtime), TypeScript accepts this assignment.
- `{ ...recipe, inTrash: true }` — spreads the existing recipe and overrides `inTrash`. The result type is `Recipe` (same shape), satisfying `saveRecipe`'s `Readonly<Recipe>` parameter.
- `await this.notifySync()` — must be called **after** `saveRecipe` resolves, not concurrently.
- If `getRecipe(uid)` throws (e.g., 404 → `PaprikaAPIError`), the error propagates immediately. `saveRecipe` and `notifySync` are never called.

**Step 1: Verify typecheck**

```bash
pnpm typecheck
```

Expected: exits 0. If you see an error about `RecipeUid` not being compatible with `string` in `getRecipe(uid)`, check that `RecipeUid` is defined as `z.string().brand("RecipeUid")` — branded types extend string and are assignable to string.

**Step 2: Commit**

```bash
git add src/paprika/client.ts
git commit -m "feat(paprika): add deleteRecipe soft-delete with notifySync"
```

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->

### Task 4: Tests for `deleteRecipe` and final verification

**Verifies:** p1-u07-client-writes.AC2.1, p1-u07-client-writes.AC2.2, p1-u07-client-writes.AC2.3

**Files:**

- Modify: `src/paprika/client.test.ts`

**Step 1: Add `RecipeUidSchema` to imports**

The tests need to create a branded `RecipeUid` value to pass to `deleteRecipe`. Add `RecipeUidSchema` to the import from `./types.js` in the test file:

```typescript
import { RecipeSchema, RecipeUidSchema } from "./types.js";
```

(Replace or extend the existing `RecipeSchema` import added in Phase 1.)

**Testing — what each test must verify:**

**p1-u07-client-writes.AC2.1 and AC2.2** — combined happy-path test:

Register three handlers for the same test:

1. `http.get(...)` on `` `${API_BASE}/recipe/${uid}/` `` → returns `HttpResponse.json({ result: makeSnakeCaseRecipe(uid) })`
2. `http.post(...)` on `` `${API_BASE}/recipe/${uid}/` `` → reads the FormData payload (same technique as Phase 1 AC1.2 test: `await request.formData()`, `.get("data")`, `.arrayBuffer()`, `gunzipSync`, `JSON.parse`), captures it in a closure variable, returns `HttpResponse.json({ result: makeSnakeCaseRecipe(uid) })`
3. `http.post(...)` on `` `${API_BASE}/notify/` `` → sets a boolean flag, returns `HttpResponse.json({ result: {} })`

Call `client.deleteRecipe(RecipeUidSchema.parse(uid))`.

Assert:

- **AC2.1**: The captured payload has `in_trash: true` (the `"in_trash"` key in the decompressed JSON is `true`)
- **AC2.2**: The notify flag is `true` (the notify POST was made)

**p1-u07-client-writes.AC2.3** — 404 from `getRecipe` propagates, no follow-on POST:

Register two handlers:

1. `http.get(...)` on `` `${API_BASE}/recipe/${uid}/` `` → returns `HttpResponse.json({}, { status: 404 })`
2. `http.post(...)` on `` `${API_BASE}/notify/` `` → sets a boolean flag, returns `HttpResponse.json({ result: {} })`

Do NOT register a handler for the save-recipe POST — if `saveRecipe` is accidentally called, MSW will return HTTP 500 (unhandled request) and the test will fail noisily.

Use the `try/catch` with `expect.fail` pattern (matching existing error tests):

```typescript
try {
  await client.deleteRecipe(RecipeUidSchema.parse(uid));
  expect.fail("Should have thrown PaprikaAPIError");
} catch (error) {
  expect(error).toBeInstanceOf(PaprikaAPIError);
}
```

After the catch block, assert the notify flag is `false`.

**Step 2: Run tests**

```bash
pnpm test
```

Expected: all tests pass (both pre-existing and all new p1-u07-client-writes tests).

**Step 3: Run typecheck**

```bash
pnpm typecheck
```

Expected: exits 0. This verifies AC4.1.

**Step 4: Run lint**

```bash
pnpm lint
```

Expected: exits 0. If lint issues appear, ask the user how to resolve them (do not suppress with comments).

**Step 5: Final commit**

```bash
git add src/paprika/client.test.ts
git commit -m "test(paprika): add deleteRecipe tests covering AC2.1–AC2.3"
```

<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->
