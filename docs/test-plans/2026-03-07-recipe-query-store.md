# Human Test Plan: Recipe Query Store

## Prerequisites

- Node.js 24 installed (via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test`
- TypeScript compiles cleanly: `pnpm typecheck`

## Phase 1: CRUD Smoke Test

| Step | Action                                                                                                                 | Expected                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 1    | In a Node REPL or test script, create a `new RecipeStore()` and check `store.size`                                     | Returns `0`                                              |
| 2    | Call `store.load()` with an array of 3 `makeRecipe()` instances (1 with `inTrash: true`) and an empty categories array | No errors thrown                                         |
| 3    | Call `store.getAll()`                                                                                                  | Returns exactly 2 recipes (the non-trashed ones)         |
| 4    | Call `store.get()` with the UID of the trashed recipe                                                                  | Returns the trashed recipe (direct lookup is unfiltered) |
| 5    | Call `store.set(makeRecipe({ uid: "new" }))` then `store.get("new")`                                                   | Returns the newly added recipe                           |
| 6    | Call `store.delete("new")` then `store.get("new")`                                                                     | Returns `undefined`                                      |
| 7    | Call `store.size`                                                                                                      | Returns 2 (same as before the set/delete)                |

## Phase 2: Category Operations

| Step | Action                                                                 | Expected                                                                |
| ---- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1    | Load store with 3 categories using `store.load([], categories)`        | No errors                                                               |
| 2    | Call `store.getAllCategories()`                                        | Returns all 3 categories in the same order they were passed to `load()` |
| 3    | Call `store.resolveCategories()` with 2 valid UIDs and 1 invalid UID   | Returns array of 2 names; the invalid UID is silently dropped           |
| 4    | Call `store.setCategories()` with a completely new set of 2 categories | Old categories disappear from `getCategory()`, new ones are retrievable |

## Phase 3: Search Behavior

| Step | Action                                                                                                                                                        | Expected                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1    | Load 4 recipes: "Cake" (exact), "Cake Mix" (starts-with), "Chocolate Cake" (contains), "Brownies" with "cake" in ingredients (other field). Search for "cake" | Returns 4 results in order: score 3, 2, 1, 0                                                    |
| 2    | Search for "CAKE" (uppercase)                                                                                                                                 | Same results as step 1 (case-insensitive)                                                       |
| 3    | Search for "" (empty string)                                                                                                                                  | Returns all non-trashed recipes, each with score 0                                              |
| 4    | Search for "cake" with `{ offset: 1, limit: 2 }`                                                                                                              | Returns exactly 2 results starting from the second-highest-scored result                        |
| 5    | Search for "cake" with `{ fields: "ingredients" }`                                                                                                            | Returns only the recipe with "cake" in its ingredients field (not the ones with "Cake" in name) |
| 6    | Add a recipe with `description: "A cake-like treat"`, search for "cake" with `{ fields: "all" }`                                                              | That recipe is also found with score 0                                                          |
| 7    | Add a trashed recipe named "Trashed Cake", search for "cake"                                                                                                  | The trashed recipe does not appear in results                                                   |

## Phase 4: Ingredient Filtering

| Step | Action                                                                                                     | Expected                                    |
| ---- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1    | Load recipe with ingredients "flour, sugar, butter". Call `filterByIngredients(["flour", "sugar"], "all")` | Recipe is returned (has both)               |
| 2    | Call `filterByIngredients(["flour", "chocolate"], "all")`                                                  | Recipe is NOT returned (missing chocolate)  |
| 3    | Call `filterByIngredients(["flour", "chocolate"], "any")`                                                  | Recipe IS returned (has flour)              |
| 4    | Call `filterByIngredients(["FLOUR"], "any")`                                                               | Recipe IS returned (case-insensitive match) |
| 5    | Load 3 matching recipes, call `filterByIngredients(["flour"], "any", 2)`                                   | Exactly 2 results returned                  |
| 6    | Call `filterByIngredients([], "any")`                                                                      | All non-trashed recipes returned            |

## Phase 5: Time Filtering

| Step | Action                                                                                     | Expected                                                 |
| ---- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| 1    | Load recipes with prepTime "10 min" and "30 min". Call `filterByTime({ maxPrepTime: 20 })` | Only the "10 min" recipe returned                        |
| 2    | Load recipe with cookTime "60 min". Call `filterByTime({ maxCookTime: 45 })`               | Recipe excluded                                          |
| 3    | Load recipe with totalTime "1:30" (90 min). Call `filterByTime({ maxTotalTime: 90 })`      | Recipe included (colon format parsed by `parseDuration`) |
| 4    | Load recipe with totalTime "not a real time". Call `filterByTime({ maxTotalTime: 60 })`    | Unparseable recipe is kept (not excluded)                |
| 5    | Load recipes with totalTime "60 min", "30 min", "45 min". Call `filterByTime({})`          | All returned, sorted: 30, 45, 60                         |
| 6    | Add recipe with `totalTime: null`. Call `filterByTime({})`                                 | Null totalTime recipe sorts after all parseable recipes  |

## Phase 6: Name Lookup

| Step | Action                                                                               | Expected                                                                     |
| ---- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 1    | Load "Chocolate Cake". Call `findByName("chocolate cake")`                           | Returns 1 result (exact match, case-insensitive)                             |
| 2    | Load "Chocolate Cake" and "Chocolate Chip Cookies". Call `findByName("chocolate c")` | Returns 2 results (starts-with tier, since no exact match for "chocolate c") |
| 3    | Load "Dark Chocolate Cake". Call `findByName("chocolate")`                           | Returns 1 result (contains tier)                                             |
| 4    | Call `findByName("nonexistent recipe name")`                                         | Returns empty array                                                          |
| 5    | Add trashed recipe "Trashed Chocolate". Call `findByName("chocolate")`               | Trashed recipe is not in results                                             |

## End-to-End: Full Store Lifecycle

**Purpose:** Validate that the store works correctly across a full usage cycle -- load, query, mutate, re-query.

| Step | Action                                                                                       | Expected                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 1    | Create a `new RecipeStore()`                                                                 | `size === 0`                                                                                             |
| 2    | Call `load()` with 5 recipes (varying names, ingredients, times; 1 trashed) and 3 categories | `size === 4`                                                                                             |
| 3    | Call `search("cake")`                                                                        | Returns only matching non-trashed recipes, sorted by score descending                                    |
| 4    | Call `filterByIngredients(["flour"], "any")`                                                 | Returns matching non-trashed recipes                                                                     |
| 5    | Call `filterByTime({ maxTotalTime: 30 })`                                                    | Returns only recipes with totalTime at or under 30 min (plus unparseable), sorted by totalTime ascending |
| 6    | Call `findByName("cake")`                                                                    | Returns matches at the highest-matching tier                                                             |
| 7    | Call `resolveCategories()` with 2 valid + 1 invalid UID                                      | Returns 2 names, invalid dropped                                                                         |
| 8    | Call `set()` with a new recipe named "New Cake"                                              | `size` increases by 1                                                                                    |
| 9    | Call `search("new cake")`                                                                    | Newly added recipe appears in results with score 3 (exact match)                                         |
| 10   | Call `delete()` on the new recipe's UID                                                      | `size` decreases by 1                                                                                    |
| 11   | Call `search("new cake")`                                                                    | No results                                                                                               |
| 12   | Call `setCategories()` with a new set                                                        | Old categories gone, new categories accessible                                                           |

## End-to-End: Trashed Recipe Exclusion

**Purpose:** Validate the invariant that trashed recipes are excluded from all query methods while remaining accessible via direct `get()`.

| Step | Action                                                                           | Expected                   |
| ---- | -------------------------------------------------------------------------------- | -------------------------- |
| 1    | Load a single trashed recipe with a distinctive name, ingredients, and totalTime | Store loads without error  |
| 2    | Call `get(uid)` with the trashed recipe's UID                                    | Returns the trashed recipe |
| 3    | Call `getAll()`                                                                  | Empty array                |
| 4    | Check `size`                                                                     | 0                          |
| 5    | Call `search()` with the trashed recipe's exact name                             | Empty array                |
| 6    | Call `filterByIngredients()` with matching term                                  | Empty array                |
| 7    | Call `filterByTime({})`                                                          | Empty array                |
| 8    | Call `findByName()` with the trashed recipe's name                               | Empty array                |

## Human Verification Required

No acceptance criteria require human verification. All 42 criteria are fully covered by automated tests. The manual test plan above serves as a supplementary end-to-end validation that the module behaves correctly when exercised interactively.
