# Test Requirements — p1-u08-disk-cache

## Overall Test Approach

All acceptance criteria for `p1-u08-disk-cache` are verified by automated tests. No human verification is required.

**Test infrastructure decisions:**

- **Real filesystem, no mocks:** All file I/O tests use `node:fs/promises` with `mkdtemp()` for per-test temp directory creation and `rm()` for teardown. This matches the existing pattern in `config.test.ts` and avoids mock drift.
- **Primary test file:** `src/cache/disk-cache.test.ts` covers all DiskCache acceptance criteria (AC1 through AC6).
- **Types regression:** `src/paprika/types.test.ts` is unchanged. Phase 1 (schema refactoring) introduces no new behaviour; the existing type tests serve as a regression gate ensuring `Recipe` and `Category` types remain structurally identical after introducing `RecipeStoredSchema` and `CategoryStoredSchema`.
- **Test fixtures:** Tests use `makeRecipe()` and `makeCategory()` factory functions from `src/cache/__fixtures__/recipes.ts` to construct valid typed objects for CRUD and diff operations.
- **Test runner:** vitest with `describe`/`it`/`expect`, `beforeEach`/`afterEach` lifecycle hooks.
- **Coverage target:** >= 70% line/branch coverage for `src/cache/disk-cache.ts`.

---

## AC1: Directory Initialisation and Index Loading

All AC1 criteria are tested in Phase 2. Tests verify `init()` behaviour across first-run, valid index, corrupt index, and I/O error scenarios.

| Criterion               | Test Type | Test File                      | Description                                                                                                                                                                                                                                                                        |
| ----------------------- | --------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p1-u08-disk-cache.AC1.1 | Unit      | `src/cache/disk-cache.test.ts` | After `init()`, assert `recipes/` and `categories/` subdirectories exist under `cacheDir` via `stat()`                                                                                                                                                                             |
| p1-u08-disk-cache.AC1.2 | Unit      | `src/cache/disk-cache.test.ts` | Write a valid `index.json` with known uid-to-hash entries before `init()`. After `init()` + `flush()`, read back `index.json` and assert the entries survived the round-trip (proves `_index` was loaded correctly)                                                                |
| p1-u08-disk-cache.AC1.3 | Unit      | `src/cache/disk-cache.test.ts` | On a fresh empty `cacheDir` (no `index.json`), call `init()` then `flush()`. Read `index.json` and assert it parses to `{ recipes: {}, categories: {} }`                                                                                                                           |
| p1-u08-disk-cache.AC1.4 | Unit      | `src/cache/disk-cache.test.ts` | Write an invalid `index.json` (e.g. schema-violating JSON with wrong value types). Create DiskCache with a log spy, call `init()`. Assert the log spy was called with a message indicating corruption. Then `flush()` and verify `index.json` is `{ recipes: {}, categories: {} }` |
| p1-u08-disk-cache.AC1.5 | Unit      | `src/cache/disk-cache.test.ts` | Make `index.json` a directory (not a file) so `readFile()` throws `EISDIR`. Assert `init()` rejects (rethrows the non-ENOENT error)                                                                                                                                                |

---

## AC2: Atomic Fsynced Flush

AC2.1, AC2.3, and AC2.4 are tested in Phase 2 (flush skeleton). AC2.2 is tested in Phase 3 (after `putRecipe`/`putCategory` populate the pending maps).

| Criterion               | Test Type | Test File                      | Description                                                                                                                     |
| ----------------------- | --------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| p1-u08-disk-cache.AC2.1 | Unit      | `src/cache/disk-cache.test.ts` | After `init()` + `flush()`, assert `index.json` exists and contains valid JSON (parseable by `JSON.parse()`)                    |
| p1-u08-disk-cache.AC2.2 | Unit      | `src/cache/disk-cache.test.ts` | Call `putRecipe()` + `putCategory()` then `flush()`. Assert `recipes/{uid}.json` and `categories/{uid}.json` exist via `stat()` |
| p1-u08-disk-cache.AC2.3 | Unit      | `src/cache/disk-cache.test.ts` | After `init()` + `flush()`, list all entries in `cacheDir` via `readdir()` and assert no entry ends with `.tmp`                 |
| p1-u08-disk-cache.AC2.4 | Unit      | `src/cache/disk-cache.test.ts` | Create DiskCache without calling `init()`. Assert `flush()` rejects with an error                                               |

---

## AC3: Recipe CRUD

All AC3 criteria are tested in Phase 3. Tests verify deferred writes, pending map reads, round-trips through Zod validation, idempotent removes, and `getAllRecipes()` merge behaviour.

| Criterion               | Test Type | Test File                      | Description                                                                                                                                                                           |
| ----------------------- | --------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p1-u08-disk-cache.AC3.1 | Unit      | `src/cache/disk-cache.test.ts` | Call `putRecipe()` without `flush()`. Assert `recipes/{uid}.json` does not exist (file I/O is deferred)                                                                               |
| p1-u08-disk-cache.AC3.2 | Unit      | `src/cache/disk-cache.test.ts` | Call `putRecipe()` then `getRecipe(uid)` without `flush()`. Assert the returned recipe deep-equals the one that was put (pending map read)                                            |
| p1-u08-disk-cache.AC3.3 | Unit      | `src/cache/disk-cache.test.ts` | Call `putRecipe()`, `flush()`, then `getRecipe(uid)`. Assert the returned recipe deep-equals the original (round-trip through JSON serialisation and `RecipeStoredSchema` validation) |
| p1-u08-disk-cache.AC3.4 | Unit      | `src/cache/disk-cache.test.ts` | Call `getRecipe('nonexistent-uid')`. Assert result is `null`                                                                                                                          |
| p1-u08-disk-cache.AC3.5 | Unit      | `src/cache/disk-cache.test.ts` | Call `putRecipe()`, `flush()` (writes file to disk), then `removeRecipe(uid)`. Assert: file no longer exists via `stat()` rejection; `getRecipe(uid)` returns `null`                  |
| p1-u08-disk-cache.AC3.6 | Unit      | `src/cache/disk-cache.test.ts` | Call `removeRecipe('uid-that-was-never-put')`. Assert it resolves without throwing (idempotent)                                                                                       |
| p1-u08-disk-cache.AC3.7 | Unit      | `src/cache/disk-cache.test.ts` | Call `putRecipe()` without `flush()`. Call `getAllRecipes()`. Assert the result array contains the pending recipe                                                                     |
| p1-u08-disk-cache.AC3.8 | Unit      | `src/cache/disk-cache.test.ts` | Put 3 recipes and `flush()`. Create a new DiskCache instance on the same directory, call `init()`, then `getAllRecipes()`. Assert 3 recipes returned, each deep-equals the original   |
| p1-u08-disk-cache.AC3.9 | Unit      | `src/cache/disk-cache.test.ts` | Call `getAllRecipes()` on a fresh cache with no recipes. Assert result is `[]`. Also: delete `recipes/` directory after `init()`, call `getAllRecipes()`, assert `[]` (ENOENT case)   |

---

## AC4: Category CRUD

All AC4 criteria are tested in Phase 3. Tests mirror the recipe pattern for categories.

| Criterion               | Test Type | Test File                      | Description                                                                                                                                                        |
| ----------------------- | --------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| p1-u08-disk-cache.AC4.1 | Unit      | `src/cache/disk-cache.test.ts` | Call `putCategory()` without `flush()`. Assert `categories/{uid}.json` does not exist                                                                              |
| p1-u08-disk-cache.AC4.2 | Unit      | `src/cache/disk-cache.test.ts` | Call `putCategory()` then `getCategory(uid)` without `flush()`. Assert returned category deep-equals the original (pending map read)                               |
| p1-u08-disk-cache.AC4.3 | Unit      | `src/cache/disk-cache.test.ts` | Call `putCategory()`, `flush()`, then `getCategory(uid)`. Assert returned category deep-equals the original (round-trip through `CategoryStoredSchema` validation) |
| p1-u08-disk-cache.AC4.4 | Unit      | `src/cache/disk-cache.test.ts` | Call `getCategory('nonexistent-uid')`. Assert result is `null`                                                                                                     |

---

## AC5: Diff Methods

All AC5 criteria are tested in Phase 4. Diff methods are synchronous and operate on `_index` in memory, so tests use `putRecipe()`/`putCategory()` to populate the index before calling `diffRecipes()`/`diffCategories()`.

| Criterion               | Test Type | Test File                      | Description                                                                                                                                                                               |
| ----------------------- | --------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p1-u08-disk-cache.AC5.1 | Unit      | `src/cache/disk-cache.test.ts` | Fresh cache (empty index). Call `diffRecipes()` with one remote entry. Assert `added` contains the UID; `changed` and `removed` are empty                                                 |
| p1-u08-disk-cache.AC5.2 | Unit      | `src/cache/disk-cache.test.ts` | `putRecipe()` with hash `v1`. Call `diffRecipes()` with same UID but hash `v2`. Assert `changed` contains the UID; `added` and `removed` are empty                                        |
| p1-u08-disk-cache.AC5.3 | Unit      | `src/cache/disk-cache.test.ts` | `putRecipe()` to populate local index. Call `diffRecipes([])` (empty remote). Assert `removed` contains the UID; `added` and `changed` are empty                                          |
| p1-u08-disk-cache.AC5.4 | Unit      | `src/cache/disk-cache.test.ts` | `putRecipe()` 3 times. Call `diffRecipes([])`. Assert `removed` has length 3 and contains all 3 UIDs                                                                                      |
| p1-u08-disk-cache.AC5.5 | Unit      | `src/cache/disk-cache.test.ts` | Fresh empty cache. Call `diffRecipes([])`. Assert result is `{ added: [], changed: [], removed: [] }`                                                                                     |
| p1-u08-disk-cache.AC5.6 | Unit      | `src/cache/disk-cache.test.ts` | `putCategory()` with hash `c1`. Call `diffCategories()` with same UID but hash `c2`. Assert `changed` contains the UID. Then call `diffCategories([])`. Assert `removed` contains the UID |
| p1-u08-disk-cache.AC5.7 | Unit      | `src/cache/disk-cache.test.ts` | Create DiskCache without `init()`. Assert `diffRecipes([])` throws                                                                                                                        |
| p1-u08-disk-cache.AC5.8 | Unit      | `src/cache/disk-cache.test.ts` | Create DiskCache without `init()`. Assert `diffCategories([])` throws                                                                                                                     |

---

## AC6: Index Consistency

AC6.1 is tested in Phase 4 (alongside diff methods, since it verifies that `putRecipe()` updates `_index` in memory for immediate diff reflection). AC6.2, AC6.3, and AC6.4 are tested in Phase 3 (alongside CRUD, since they verify that `flush()` persists index changes and that unflushed puts do not modify the on-disk index).

| Criterion               | Test Type | Test File                      | Description                                                                                                                                                                                                                                                              |
| ----------------------- | --------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| p1-u08-disk-cache.AC6.1 | Unit      | `src/cache/disk-cache.test.ts` | `putRecipe()` with hash `v1`. Call `diffRecipes()` with same hash. Assert no changes. Then `putRecipe()` again with hash `v2` (no `flush()`). Call `diffRecipes()` with hash `v1`. Assert `changed` contains the UID (proves `_index` was updated in memory immediately) |
| p1-u08-disk-cache.AC6.2 | Unit      | `src/cache/disk-cache.test.ts` | `putRecipe(recipe, 'my-hash')` + `flush()`. Read `index.json` from disk, parse it, assert `recipes[uid] === 'my-hash'`                                                                                                                                                   |
| p1-u08-disk-cache.AC6.3 | Unit      | `src/cache/disk-cache.test.ts` | `putRecipe()` + `flush()`, then `removeRecipe(uid)` + `flush()`. Read `index.json` and assert the UID is no longer a key in `recipes`                                                                                                                                    |
| p1-u08-disk-cache.AC6.4 | Unit      | `src/cache/disk-cache.test.ts` | `putRecipe()` without `flush()`. Assert `index.json` does not exist (on a fresh cache where `flush()` was never called)                                                                                                                                                  |

---

## Phase 1: Schema Extension (Regression Gate)

Phase 1 introduces `RecipeStoredSchema`, `CategoryStoredSchema`, `recipeCamelShape`, and `categoryCamelShape` in `src/paprika/types.ts`. This is a structural refactoring with no new behaviour. The acceptance criteria for the disk cache (AC1-AC6) do not directly cover Phase 1 -- instead, it is verified by:

| Verification             | Type            | File                        | Description                                                                                                                                                                                                    |
| ------------------------ | --------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Types regression         | Unit (existing) | `src/paprika/types.test.ts` | All existing tests must continue to pass, confirming `Recipe` and `Category` types are structurally identical after the refactoring                                                                            |
| Compile-time consistency | Typecheck       | N/A (`pnpm typecheck`)      | The `: Recipe` annotation on `RecipeSchema`'s transform return and `: Category` on `CategorySchema`'s transform return enforce at compile time that the API schemas and stored schemas produce identical types |

---

## Human Verification

No acceptance criteria require human verification. All 30 AC cases (AC1.1-AC1.5, AC2.1-AC2.4, AC3.1-AC3.9, AC4.1-AC4.4, AC5.1-AC5.8, AC6.1-AC6.4) are covered by automated unit tests with real filesystem I/O.

**Rationale:** DiskCache is a pure I/O layer with no UI, no user-facing output, and no external service dependencies. All its behaviour is deterministic and observable through filesystem state assertions. The real-filesystem test approach (using `mkdtemp`/`rm` per test) eliminates the need for manual file inspection, and the atomic-write correctness (temp-then-rename) is verified by asserting no `.tmp` files remain after `flush()`.

---

## Coverage Summary

| Test File                      | AC Groups Covered            | Test Count     | Notes                                                                            |
| ------------------------------ | ---------------------------- | -------------- | -------------------------------------------------------------------------------- |
| `src/cache/disk-cache.test.ts` | AC1, AC2, AC3, AC4, AC5, AC6 | 30+ tests      | All DiskCache acceptance criteria; real filesystem with `mkdtemp`/`rm` isolation |
| `src/paprika/types.test.ts`    | (Phase 1 regression)         | Existing tests | No changes needed; serves as regression gate for schema refactoring              |

**Approach:**

- All tests are unit tests using real filesystem I/O (no mocks, no in-memory filesystem stubs)
- Each test gets an isolated temp directory via `mkdtemp(join(tmpdir(), 'paprika-disk-cache-'))`, removed in `afterEach` via `rm(tempDir, { recursive: true, force: true })`
- Tests use `makeRecipe()` / `makeCategory()` factory functions from `src/cache/__fixtures__/recipes.ts`
- Phase 4 also includes a mixed-scenario test (added + changed + removed in one `diffRecipes()` call) that goes beyond the individual AC cases
- Coverage target is >= 70% for `src/cache/disk-cache.ts`, verified via `pnpm test -- --coverage`
