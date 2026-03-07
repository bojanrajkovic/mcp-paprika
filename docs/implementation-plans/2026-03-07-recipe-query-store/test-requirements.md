# Test Requirements: Recipe Query Store

Maps each acceptance criterion from the [design plan](../../design-plans/2026-03-07-recipe-query-store.md) to automated tests or human verification.

---

## AC1: CRUD Operations

All AC1 criteria are fully automatable as unit tests.

| AC                        | Text                                                                           | Test Type | Test File                        | Verification Description                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------ | --------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| recipe-query-store.AC1.1  | `load(recipes, categories)` populates both Maps correctly                      | Unit      | `src/cache/recipe-store.test.ts` | Call `load()` with recipes and categories, verify `get()` returns each loaded recipe and `getCategory()` returns each loaded category |
| recipe-query-store.AC1.2  | `get(uid)` returns the recipe with matching UID                                | Unit      | `src/cache/recipe-store.test.ts` | Load a recipe, call `get(uid)`, assert the returned object matches                                                                    |
| recipe-query-store.AC1.3  | `get('nonexistent')` returns `undefined`                                       | Unit      | `src/cache/recipe-store.test.ts` | Call `get()` with a UID not in the store, assert `undefined` is returned                                                              |
| recipe-query-store.AC1.4  | `getAll()` returns all recipes where `inTrash === false`                       | Unit      | `src/cache/recipe-store.test.ts` | Load a mix of trashed and non-trashed recipes, verify `getAll()` returns only non-trashed recipes                                     |
| recipe-query-store.AC1.5  | `getAll()` excludes recipes where `inTrash === true`                           | Unit      | `src/cache/recipe-store.test.ts` | Same test as AC1.4 — verify the trashed recipe is absent from the `getAll()` result                                                   |
| recipe-query-store.AC1.6  | `set(recipe)` adds a new recipe; `get(recipe.uid)` retrieves it                | Unit      | `src/cache/recipe-store.test.ts` | Call `set()` with a new recipe, then `get()` with its UID, assert the recipe is returned                                              |
| recipe-query-store.AC1.7  | `set(recipe)` overwrites an existing recipe with the same UID                  | Unit      | `src/cache/recipe-store.test.ts` | Call `set()` twice with the same UID but different `name`, verify `get()` returns the second value                                    |
| recipe-query-store.AC1.8  | `delete(uid)` removes the recipe; subsequent `get(uid)` returns `undefined`    | Unit      | `src/cache/recipe-store.test.ts` | Call `set()`, then `delete()`, then `get()` — assert `undefined`                                                                      |
| recipe-query-store.AC1.9  | `delete('nonexistent')` does not throw                                         | Unit      | `src/cache/recipe-store.test.ts` | Call `delete()` with a UID not in the store, assert no exception is thrown                                                            |
| recipe-query-store.AC1.10 | `size` returns 0 on a fresh store                                              | Unit      | `src/cache/recipe-store.test.ts` | Construct a new `RecipeStore`, assert `size === 0`                                                                                    |
| recipe-query-store.AC1.11 | `size` returns count of non-trashed recipes only                               | Unit      | `src/cache/recipe-store.test.ts` | Load a mix of trashed and non-trashed recipes, assert `size` equals the non-trashed count                                             |
| recipe-query-store.AC1.12 | After `load()`, `size` reflects the number of non-trashed recipes in the input | Unit      | `src/cache/recipe-store.test.ts` | Load 3 recipes (1 trashed), assert `size === 2`                                                                                       |

---

## AC2: Category Operations

All AC2 criteria are fully automatable as unit tests.

| AC                       | Text                                                                                      | Test Type | Test File                        | Verification Description                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------- | --------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| recipe-query-store.AC2.1 | `resolveCategories(['uid-1', 'uid-2'])` returns `['Name1', 'Name2']` when both exist      | Unit      | `src/cache/recipe-store.test.ts` | Load two categories, call `resolveCategories()` with both UIDs, assert both names are returned in order                |
| recipe-query-store.AC2.2 | `resolveCategories(['uid-1', 'unknown'])` returns `['Name1']` (unknown UID dropped)       | Unit      | `src/cache/recipe-store.test.ts` | Load one category, call `resolveCategories()` with its UID and an unknown UID, assert only the known name is returned  |
| recipe-query-store.AC2.3 | `resolveCategories([])` returns `[]`                                                      | Unit      | `src/cache/recipe-store.test.ts` | Call `resolveCategories([])`, assert empty array returned                                                              |
| recipe-query-store.AC2.4 | `setCategories(categories)` replaces all categories; `getCategory()` reflects the new set | Unit      | `src/cache/recipe-store.test.ts` | Load initial categories, call `setCategories()` with new ones, verify old categories are gone and new ones are present |
| recipe-query-store.AC2.5 | `getAllCategories()` returns all categories in insertion order                            | Unit      | `src/cache/recipe-store.test.ts` | Load categories in a specific order, call `getAllCategories()`, assert the returned array preserves insertion order    |
| recipe-query-store.AC2.6 | `getCategory(uid)` returns the category with matching UID                                 | Unit      | `src/cache/recipe-store.test.ts` | Load a category, call `getCategory(uid)`, assert the returned object matches                                           |

---

## AC3: Search Method

All AC3 criteria are automatable. AC3.5 and AC3.8 have additional property-based test coverage.

| AC                       | Text                                                                            | Test Type      | Test File                                                                   | Verification Description                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recipe-query-store.AC3.1 | Case-insensitive substring match finds recipes by name                          | Unit           | `src/cache/recipe-store.test.ts`                                            | Load recipes with different names, search for a substring in mixed case, assert matching recipes are returned                                                                                                                                                                                                                      |
| recipe-query-store.AC3.2 | With `fields: 'all'`, searches name, ingredients, description, and notes        | Unit           | `src/cache/recipe-store.test.ts`                                            | Load four recipes, each with the query term in a different field (name, ingredients, description, notes). Search with `fields: 'all'`, assert all four are found. Verify `description` and `notes` search paths individually.                                                                                                      |
| recipe-query-store.AC3.3 | Field scoping (e.g., `fields: 'ingredients'`) limits search to that field only  | Unit           | `src/cache/recipe-store.test.ts`                                            | Load a recipe with the term in both name and ingredients. Search with `fields: 'ingredients'`, assert it is found. Load another recipe with term only in name, search with `fields: 'ingredients'`, assert it is NOT returned.                                                                                                     |
| recipe-query-store.AC3.4 | Scoring: exact name match=3, starts-with=2, name-contains=1, other-field-only=0 | Unit           | `src/cache/recipe-store.test.ts`                                            | Load 4 recipes: one exact name match, one starts-with, one contains, one with term only in ingredients. Search and verify scores are 3, 2, 1, 0 respectively.                                                                                                                                                                      |
| recipe-query-store.AC3.5 | Results sorted by score descending, then name ascending within same score       | Unit, Property | `src/cache/recipe-store.test.ts`, `src/cache/recipe-store.property.test.ts` | **Unit:** Same data as AC3.4, verify result order is score 3, 2, 1, 0. For same score, verify alphabetical name order. **Property:** For any non-empty query string, assert consecutive results satisfy `results[i].score >= results[i+1].score`, and when scores are equal, `results[i].recipe.name <= results[i+1].recipe.name`. |
| recipe-query-store.AC3.6 | Pagination with `offset` and `limit` applied after scoring and sorting          | Unit           | `src/cache/recipe-store.test.ts`                                            | Load 5 matching recipes, search with `offset: 1, limit: 2`, assert exactly 2 results starting from index 1 of the sorted order                                                                                                                                                                                                     |
| recipe-query-store.AC3.7 | Empty query string returns all non-trashed recipes (each scored 0)              | Unit           | `src/cache/recipe-store.test.ts`                                            | Search with `""`, assert all non-trashed recipes are returned, each with `score === 0`                                                                                                                                                                                                                                             |
| recipe-query-store.AC3.8 | Trashed recipes never appear in search results                                  | Unit, Property | `src/cache/recipe-store.test.ts`, `src/cache/recipe-store.property.test.ts` | **Unit:** Load a trashed recipe, search for its name, assert it is not in results. **Property:** For any query string, assert every result has `inTrash === false`.                                                                                                                                                                |

---

## AC4: Ingredient Filtering

All AC4 criteria are automatable. AC4.6 has additional property-based test coverage.

| AC                       | Text                                                             | Test Type      | Test File                                                                   | Verification Description                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recipe-query-store.AC4.1 | `'all'` mode returns only recipes containing every search term   | Unit           | `src/cache/recipe-store.test.ts`                                            | Recipe has "flour, sugar, butter". Search `['flour', 'sugar']` with `'all'` — found. Search `['flour', 'chocolate']` with `'all'` — not found.                                                                      |
| recipe-query-store.AC4.2 | `'any'` mode returns recipes containing at least one search term | Unit           | `src/cache/recipe-store.test.ts`                                            | Search `['flour', 'chocolate']` with `'any'` — found (has flour)                                                                                                                                                    |
| recipe-query-store.AC4.3 | Matching is case-insensitive                                     | Unit           | `src/cache/recipe-store.test.ts`                                            | Search `['FLOUR']` with `'any'`, assert recipe with "flour" in ingredients is matched                                                                                                                               |
| recipe-query-store.AC4.4 | `limit` parameter caps the number of results returned            | Unit           | `src/cache/recipe-store.test.ts`                                            | Load 3 matching recipes, call with `limit: 2`, assert exactly 2 results returned                                                                                                                                    |
| recipe-query-store.AC4.5 | Empty terms array returns all non-trashed recipes                | Unit           | `src/cache/recipe-store.test.ts`                                            | Call `filterByIngredients([], 'any')`, assert all non-trashed recipes are returned                                                                                                                                  |
| recipe-query-store.AC4.6 | Trashed recipes never appear in filtered results                 | Unit, Property | `src/cache/recipe-store.test.ts`, `src/cache/recipe-store.property.test.ts` | **Unit:** Load a trashed recipe with matching ingredients, assert it is not in results. **Property:** For any ingredient term, assert every result of `filterByIngredients([term], 'any')` has `inTrash === false`. |

---

## AC5: Time Filtering

All AC5 criteria are automatable. AC5.5 has additional property-based test coverage.

| AC                       | Text                                                                     | Test Type      | Test File                                                                   | Verification Description                                                                                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------ | -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| recipe-query-store.AC5.1 | Filters recipes by `maxPrepTime` constraint (in minutes)                 | Unit           | `src/cache/recipe-store.test.ts`                                            | Recipe with `prepTime: "30 min"` excluded by `maxPrepTime: 20`. Recipe with `prepTime: "10 min"` included.                                                                                                                           |
| recipe-query-store.AC5.2 | Filters recipes by `maxCookTime` constraint (in minutes)                 | Unit           | `src/cache/recipe-store.test.ts`                                            | Same pattern as AC5.1 for `cookTime` / `maxCookTime`                                                                                                                                                                                 |
| recipe-query-store.AC5.3 | Filters recipes by `maxTotalTime` constraint (in minutes)                | Unit           | `src/cache/recipe-store.test.ts`                                            | Same pattern as AC5.1 for `totalTime` / `maxTotalTime`                                                                                                                                                                               |
| recipe-query-store.AC5.4 | Multiple constraints applied simultaneously (all must pass)              | Unit           | `src/cache/recipe-store.test.ts`                                            | Recipe with `prepTime: "10 min"`, `cookTime: "60 min"`. Constraints `maxPrepTime: 15, maxCookTime: 30` — excluded because `cookTime` exceeds its constraint.                                                                         |
| recipe-query-store.AC5.5 | Recipes with unparseable time strings are kept in results (not excluded) | Unit, Property | `src/cache/recipe-store.test.ts`, `src/cache/recipe-store.property.test.ts` | **Unit:** Recipe with `totalTime: "not a real time"` is kept in results when `maxTotalTime` constraint is set. **Property:** For any integer constraint value, the recipe with unparseable `totalTime` is always present in results. |
| recipe-query-store.AC5.6 | Results sorted by `totalTime` ascending (parsed values)                  | Unit           | `src/cache/recipe-store.test.ts`                                            | Load recipes with `totalTime` of "60 min", "30 min", "45 min". Assert sorted order is 30, 45, 60.                                                                                                                                    |
| recipe-query-store.AC5.7 | Recipes with unparseable `totalTime` sort after all parseable recipes    | Unit           | `src/cache/recipe-store.test.ts`                                            | Load recipes with parseable and unparseable/null `totalTime` values. Assert unparseable and null recipes appear after all parseable recipes in the result.                                                                           |
| recipe-query-store.AC5.8 | No constraints set returns all non-trashed recipes                       | Unit           | `src/cache/recipe-store.test.ts`                                            | Call `filterByTime({})`, assert all non-trashed recipes are returned (still sorted by `totalTime`)                                                                                                                                   |
| recipe-query-store.AC5.9 | Time parsing delegates to `parseDuration` from `src/utils/duration.ts`   | Unit           | `src/cache/recipe-store.test.ts`                                            | Implicitly verified by all AC5 time-parsing tests. Explicitly verified by testing colon format `"1:30"` (90 minutes) works correctly, since only `parseDuration` handles that format.                                                |

---

## AC6: Name Lookup

All AC6 criteria are fully automatable. AC6.6 has additional property-based test coverage.

| AC                       | Text                                                                             | Test Type      | Test File                                                                   | Verification Description                                                                                                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------- | -------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recipe-query-store.AC6.1 | Exact case-insensitive match returns the matching recipe                         | Unit           | `src/cache/recipe-store.test.ts`                                            | Load recipe named "Chocolate Cake", call `findByName("chocolate cake")`, assert it is returned                                                                                                                                              |
| recipe-query-store.AC6.2 | Starts-with match used when no exact match exists                                | Unit           | `src/cache/recipe-store.test.ts`                                            | Load "Chocolate Cake" and "Chocolate Chip Cookies", call `findByName("chocolate c")`, assert both are returned (starts-with tier, since no exact match)                                                                                     |
| recipe-query-store.AC6.3 | Contains match used when no starts-with match exists                             | Unit           | `src/cache/recipe-store.test.ts`                                            | Load "Dark Chocolate Cake", call `findByName("chocolate")`, assert it is returned (contains tier, since no exact or starts-with match)                                                                                                      |
| recipe-query-store.AC6.4 | Returns all matches at the first successful tier (e.g., two starts-with matches) | Unit           | `src/cache/recipe-store.test.ts`                                            | Load "Apple Pie" and "Apple Strudel", call `findByName("apple")`, assert both are returned                                                                                                                                                  |
| recipe-query-store.AC6.5 | No matches at any tier returns empty array                                       | Unit           | `src/cache/recipe-store.test.ts`                                            | Call `findByName("nonexistent recipe name")`, assert empty array returned                                                                                                                                                                   |
| recipe-query-store.AC6.6 | Only searches non-trashed recipes                                                | Unit, Property | `src/cache/recipe-store.test.ts`, `src/cache/recipe-store.property.test.ts` | **Unit:** Load trashed recipe named "Trashed Chocolate", call `findByName("chocolate")`, assert the trashed recipe is not returned. **Property:** For any search title, assert every result of `findByName(title)` has `inTrash === false`. |

---

## AC7: Module Characteristics

AC7.1 is verified by the TypeScript compiler. AC7.2 through AC7.4 are verified by source-file inspection tests. None require human verification.

| AC                       | Text                                                                             | Test Type | Test File                        | Verification Description                                                                                                                                    |
| ------------------------ | -------------------------------------------------------------------------------- | --------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| recipe-query-store.AC7.1 | TypeScript compiles with no errors                                               | Compiler  | N/A (`pnpm typecheck`)           | Verified by `pnpm typecheck` succeeding. No dedicated test — the TypeScript compiler is the verifier. CI enforces this on every push.                       |
| recipe-query-store.AC7.2 | No I/O operations — all methods are synchronous in-memory operations             | Unit      | `src/cache/recipe-store.test.ts` | Read `src/cache/recipe-store.ts` source at test time, assert it does not contain imports from I/O modules (`fs`, `http`, `net`, `child_process`, `fetch`)   |
| recipe-query-store.AC7.3 | All methods are synchronous (no `async`, no `Promise`)                           | Unit      | `src/cache/recipe-store.test.ts` | Read the source file, assert `source` does not match `/\basync\b/` and does not match `/Promise/`                                                           |
| recipe-query-store.AC7.4 | Imports only from `paprika/types.ts` and `utils/duration.ts` (plus npm packages) | Unit      | `src/cache/recipe-store.test.ts` | Read the source file, extract all relative `from ".."` import paths via regex, assert they are exactly `"../paprika/types.js"` and `"../utils/duration.js"` |

---

## Criteria Requiring Human Verification

No acceptance criteria require human verification. All 42 criteria across AC1 through AC7 are fully automatable:

- **AC1 (12 criteria):** Standard CRUD assertions on a `RecipeStore` instance.
- **AC2 (6 criteria):** Standard category operation assertions on a `RecipeStore` instance.
- **AC3 (8 criteria):** Deterministic search behavior with known fixture data, plus property-based invariant checks.
- **AC4 (6 criteria):** Deterministic filtering behavior with known fixture data, plus property-based invariant checks.
- **AC5 (9 criteria):** Deterministic time filtering with known duration strings, plus property-based invariant checks.
- **AC6 (6 criteria):** Deterministic tiered lookup with known recipe names, plus property-based invariant checks.
- **AC7 (4 criteria):** Compiler verification (AC7.1) and source-file inspection tests (AC7.2-AC7.4).

---

## Test File Summary

| File                                      | Test Type      | Criteria Covered                                                                           |
| ----------------------------------------- | -------------- | ------------------------------------------------------------------------------------------ |
| `src/cache/recipe-store.test.ts`          | Unit           | AC1.1-AC1.12, AC2.1-AC2.6, AC3.1-AC3.8, AC4.1-AC4.6, AC5.1-AC5.9, AC6.1-AC6.6, AC7.2-AC7.4 |
| `src/cache/recipe-store.property.test.ts` | Property-based | AC3.5, AC3.8, AC4.6, AC5.5, AC6.6                                                          |
| N/A (`pnpm typecheck`)                    | Compiler       | AC7.1                                                                                      |

---

## Test Infrastructure Dependencies

| Dependency                          | Purpose                                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/cache/__fixtures__/recipes.ts` | `makeRecipe()` and `makeCategory()` factory functions, `TRASHED_RECIPE` and `FULLY_POPULATED_RECIPE` constants |
| `vitest`                            | Test runner, `describe`/`it`/`expect` assertions                                                               |
| `fast-check`                        | Property-based test generators and `fc.assert`/`fc.property`                                                   |
| `node:fs` (in tests only)           | Reading source file for AC7.2-AC7.4 module characteristic tests                                                |
