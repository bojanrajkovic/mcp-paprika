# Test Requirements: PaprikaClient Read Operations (P1-U06)

Maps each acceptance criterion from the design plan to an automated test or human verification step.

**Test file:** `src/paprika/client.test.ts`

---

## AC1: listRecipes() returns a recipe entry list

### p1-u06-client-reads.AC1.1: Returns `RecipeEntry[]` where each entry has `uid: RecipeUid` and `hash: string`, fetched from `/api/v2/sync/recipes/`

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC1.1 - listRecipes() returns RecipeEntry[] with uid and hash from /recipes/ endpoint")`
**Verifies:** MSW handler at `/api/v2/sync/recipes/` returns a JSON envelope with two entries. After calling `client.listRecipes()`, the returned array has length 2, and each entry has the expected `uid` and `hash` values.
**Implementation task:** Phase 1, Task 2

---

### p1-u06-client-reads.AC1.2: Returns `[]` when the API returns an empty result array

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC1.2 - listRecipes() returns [] when API returns empty result array")`
**Verifies:** MSW handler returns `{ result: [] }`. After calling `client.listRecipes()`, the returned array is empty (`[]`).
**Implementation task:** Phase 1, Task 2

---

## AC2: getRecipe() returns a full recipe by UID

### p1-u06-client-reads.AC2.1: Returns a `Recipe` object with all fields in camelCase, fetched from `/api/v2/sync/recipe/{uid}/`

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC2.1 - getRecipe() returns Recipe with camelCase fields from /recipe/{uid}/ endpoint")`
**Verifies:** MSW handler at `/api/v2/sync/recipe/test-uid/` returns a snake_case recipe via `makeSnakeCaseRecipe("test-uid")`. After calling `client.getRecipe("test-uid")`, the returned object has camelCase field names (`prepTime`, `onFavorites`, `imageUrl`) and correct values (`name === "Recipe test-uid"`).
**Implementation task:** Phase 1, Task 2

---

### p1-u06-client-reads.AC2.2: A non-2xx response propagates as `PaprikaAPIError`

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC2.2 - getRecipe() throws PaprikaAPIError on non-2xx response")`
**Verifies:** MSW handler at `/api/v2/sync/recipe/not-found/` returns HTTP 404. Calling `client.getRecipe("not-found")` rejects with an error that is `instanceof PaprikaAPIError`.
**Implementation task:** Phase 1, Task 2

---

## AC3: getRecipes() fetches multiple recipes with concurrency limiting

### p1-u06-client-reads.AC3.1: Returns `Recipe[]` with one entry per provided UID, in the same order

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC3.1 - getRecipes() returns Recipe[] in same order as provided UIDs")`
**Verifies:** MSW handler at `/api/v2/sync/recipe/:uid/` returns a recipe keyed by the path param. After calling `client.getRecipes(["uid-1", "uid-2", "uid-3"])`, the returned array has length 3 and order is preserved (index 0 has `name === "Recipe uid-1"`, index 1 has `name === "Recipe uid-2"`, etc.).
**Implementation task:** Phase 2, Task 2

---

### p1-u06-client-reads.AC3.2: `getRecipes([])` returns `[]` with zero HTTP requests made

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC3.2 - getRecipes([]) returns [] with no HTTP requests")`
**Verifies:** No MSW handler is registered (unmatched routes would cause a 500 error). Calling `client.getRecipes([])` resolves to `[]` without making any HTTP requests.
**Implementation task:** Phase 2, Task 2

---

### p1-u06-client-reads.AC3.3: At most 5 `getRecipe()` calls execute simultaneously (bulkhead cap)

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC3.3 - getRecipes() limits concurrency to 5 simultaneous requests")`
**Verifies:** MSW handler uses a shared `inFlight` counter with a 20ms delay to simulate concurrent execution. With 10 UIDs, after `client.getRecipes(uids)` resolves, the observed `peakInFlight` is `<= 5`.
**Implementation task:** Phase 2, Task 2

---

### p1-u06-client-reads.AC3.4: A single recipe fetch error causes the entire `getRecipes()` call to reject

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC3.4 - getRecipes() rejects entirely when a single recipe fetch fails")`
**Verifies:** MSW returns a valid recipe for `good-uid` and HTTP 404 for `bad-uid`. Calling `client.getRecipes(["good-uid", "bad-uid"])` rejects with `PaprikaAPIError`. Uses HTTP 404 (not 500) to avoid retry delays since 404 is not in `RETRYABLE_STATUSES`.
**Implementation task:** Phase 2, Task 2

---

## AC4: listCategories() returns hydrated Category objects

### p1-u06-client-reads.AC4.1: Returns `Category[]` with all fields in camelCase (not raw `CategoryEntry[]`)

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC4.1 - listCategories() returns Category[] with camelCase fields")`
**Verifies:** MSW returns one category entry from `/categories/` and a snake_case category object from `/category/cat-1/`. After calling `client.listCategories()`, the result has length 1 and the element has camelCase fields: `orderFlag === 1` (not `order_flag`), `parentUid === null` (not `parent_uid`), `name === "Breakfast"`.
**Implementation task:** Phase 2, Task 2

---

### p1-u06-client-reads.AC4.2: Makes exactly one request to `/categories/` then N requests to `/category/{uid}/`

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC4.2 - listCategories() makes one list request then N hydration requests")`
**Verifies:** MSW handlers track `listCount` and `hydrateCount` via counters. With two category entries, after calling `client.listCategories()`, asserts `listCount === 1` and `hydrateCount === 2`.
**Implementation task:** Phase 2, Task 2

---

### p1-u06-client-reads.AC4.3: Returns `[]` when `/categories/` returns an empty list, with no hydration requests made

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC4.3 - listCategories() returns [] with no hydration when list is empty")`
**Verifies:** MSW returns `{ result: [] }` from `/categories/`. No hydration handler is registered. Calling `client.listCategories()` resolves to `[]`. Any unmatched hydration request would cause MSW to return an error, automatically failing the test.
**Implementation task:** Phase 2, Task 2

---

### p1-u06-client-reads.AC4.4: At most 5 hydration requests execute simultaneously, independently of the recipe bulkhead

**Type:** Automated (unit)
**Test file:** `src/paprika/client.test.ts`
**Test name/description:** `it("p1-u06-client-reads.AC4.4 - listCategories() limits hydration concurrency to 5, independently of recipe bulkhead")`
**Verifies:** MSW handler at `/category/:uid/` uses an `inFlight` counter with a 20ms delay. With 10 category entries, `peakInFlight <= 5` after `client.listCategories()` resolves. Additionally, a concurrent `getRecipes()` call runs at the same time, and both resolve successfully with their respective peak concurrency staying `<= 5`, confirming the two bulkheads are independent.
**Implementation task:** Phase 2, Task 2

---

## AC5: P1-U05 suppression stubs are removed

### p1-u06-client-reads.AC5.1: The `@ts-expect-error` and `eslint-disable` comments on `API_BASE` are removed

**Type:** Automated (build verification) + Human verification
**Test file:** N/A (verified by `pnpm typecheck` and code inspection)
**Test name/description:** N/A
**Verifies:** `pnpm typecheck` passes with no errors after removing the two suppression comments from `API_BASE`. If the comments were still present but `API_BASE` now has callers, TypeScript would emit an error for the now-unnecessary `@ts-expect-error` directive, causing `pnpm typecheck` to fail. This makes `pnpm typecheck` a sufficient automated gate.
**Justification for human verification component:** While `pnpm typecheck` confirms the stubs are unnecessary (and would fail if they remained), a brief visual inspection of `src/paprika/client.ts` confirms the lines are physically removed rather than replaced with different suppressions. This is a one-time review during code review.
**Manual verification approach:** Open `src/paprika/client.ts` and confirm that the `const API_BASE = ...` declaration has no `@ts-expect-error` or `eslint-disable` comment on the lines immediately above it.
**Implementation task:** Phase 1, Task 1

---

### p1-u06-client-reads.AC5.2: The `@ts-expect-error` comment on `request()` is removed

**Type:** Automated (build verification) + Human verification
**Test file:** N/A (verified by `pnpm typecheck` and code inspection)
**Test name/description:** N/A
**Verifies:** `pnpm typecheck` passes with no errors after removing the suppression comment from `request()`. If the comment were still present but `request()` now has callers (via `listRecipes()` and `getRecipe()`), TypeScript would emit an error for the unnecessary `@ts-expect-error`, causing `pnpm typecheck` to fail.
**Justification for human verification component:** Same rationale as AC5.1 -- `pnpm typecheck` is the automated gate, but visual confirmation during code review ensures the line is physically removed.
**Manual verification approach:** Open `src/paprika/client.ts` and confirm that the `private async request<T>(` declaration has no `@ts-expect-error` comment on the line immediately above it.
**Implementation task:** Phase 1, Task 1

---

### p1-u06-client-reads.AC5.3: TypeScript compiles with no errors after the changes

**Type:** Automated (build verification)
**Test file:** N/A (verified by `pnpm typecheck`)
**Test name/description:** N/A
**Verifies:** `pnpm typecheck` (which runs `tsc --noEmit`) exits with code 0 after all Phase 1 and Phase 2 changes are applied. This is run as part of the final verification step in both phases and is enforced by the `pre-push` git hook and CI pipeline.
**Implementation task:** Phase 1, Task 1 (verification step); Phase 2, Task 1 (verification step)

---

## Summary

| AC  | Sub | Type               | Automated | Phase | Task |
| --- | --- | ------------------ | --------- | ----- | ---- |
| AC1 | 1.1 | Unit test          | Yes       | 1     | 2    |
| AC1 | 1.2 | Unit test          | Yes       | 1     | 2    |
| AC2 | 2.1 | Unit test          | Yes       | 1     | 2    |
| AC2 | 2.2 | Unit test          | Yes       | 1     | 2    |
| AC3 | 3.1 | Unit test          | Yes       | 2     | 2    |
| AC3 | 3.2 | Unit test          | Yes       | 2     | 2    |
| AC3 | 3.3 | Unit test          | Yes       | 2     | 2    |
| AC3 | 3.4 | Unit test          | Yes       | 2     | 2    |
| AC4 | 4.1 | Unit test          | Yes       | 2     | 2    |
| AC4 | 4.2 | Unit test          | Yes       | 2     | 2    |
| AC4 | 4.3 | Unit test          | Yes       | 2     | 2    |
| AC4 | 4.4 | Unit test          | Yes       | 2     | 2    |
| AC5 | 5.1 | Build + human      | Partial   | 1     | 1    |
| AC5 | 5.2 | Build + human      | Partial   | 1     | 1    |
| AC5 | 5.3 | Build verification | Yes       | 1     | 1    |

**Total automated tests in `client.test.ts`:** 12 (4 from Phase 1, 8 from Phase 2)
**Build verification checks:** 3 (AC5.1, AC5.2, AC5.3 via `pnpm typecheck`)
**Human verification:** 2 (AC5.1, AC5.2 visual confirmation during code review)
