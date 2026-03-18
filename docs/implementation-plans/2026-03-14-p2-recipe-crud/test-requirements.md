# Test Requirements: p2-recipe-crud

## Summary

This document maps all 41 acceptance criteria (AC1.1--AC1.9, AC2.1--AC2.9, AC3.1--AC3.7, AC4.1--AC4.7, AC-helpers.1--AC-helpers.9) from the p2-recipe-crud design plan to automated Vitest unit tests. All criteria are automatable: tools are tested via direct `registerTool()` + `callTool()` calls with a real in-memory `RecipeStore`, write tools use `vi.fn()` mocks for `saveRecipe`, `notifySync`, `putRecipe`, and `flush`, and no real network or disk I/O is required.

Total criteria: 41
Automated: 41
Manual: 0

---

## Automated Tests

### AC1: read_recipe (`src/tools/read.test.ts`)

| Criterion | Test type | Description                                                                                                                                  |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| AC1.1     | unit      | UID lookup returns the recipe rendered as markdown (contains `# <name>` heading and category names)                                          |
| AC1.2     | unit      | Exact title match (`"Chocolate Cake"`) returns the single matching recipe as markdown                                                        |
| AC1.3     | unit      | Partial title match (startsWith and includes variants) returns the recipe markdown when exactly one recipe matches                           |
| AC1.4     | unit      | Multiple title matches return a disambiguation list containing each recipe's name and UID, without full recipe content (no `## Ingredients`) |
| AC1.5     | unit      | UID not found returns a text result containing "not found"                                                                                   |
| AC1.6     | unit      | Title search with zero matches returns a text result containing "not found"                                                                  |
| AC1.7     | unit      | Neither `uid` nor `title` provided returns an error message asking the caller to provide one                                                 |
| AC1.8     | unit      | Cold-start (empty/unloaded store) returns the cold-start guard message containing "try again"                                                |
| AC1.9     | unit      | Both `uid` and `title` provided -- UID takes precedence; result contains the UID-matched recipe's name, not the title-matched recipe's name  |

### AC2: create_recipe (`src/tools/create.test.ts`)

| Criterion | Test type | Description                                                                                                                                                    |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC2.1     | unit      | Required fields only (`name`, `ingredients`, `directions`) creates a recipe; result markdown contains `# <name>`, `## Ingredients`, and `## Directions`        |
| AC2.2     | unit      | Optional fields (`description`, `servings`, `prepTime`, etc.) are reflected in the returned markdown when provided                                             |
| AC2.3     | unit      | Omitted optional fields default to `null` (not empty string) on the `Recipe` object passed to `saveRecipe`                                                     |
| AC2.4     | unit      | Valid category names are resolved to `CategoryUid` values via `resolveCategoryNames`; the `categories` array passed to `saveRecipe` contains the matching UIDs |
| AC2.5     | unit      | `saveRecipe` is called exactly once and `notifySync` is called exactly once (via `commitRecipe`)                                                               |
| AC2.6     | unit      | `putRecipe` is called with the saved recipe and its hash; `flush` is called once; `store.get(uid)` returns the saved recipe                                    |
| AC2.7     | unit      | Unrecognized category name is excluded from the `categories` array and a `Warning: category "<name>" not found` message appears in the result text             |
| AC2.8     | unit      | `saveRecipe` throws -- result text contains "Failed to create" and the error message; `putRecipe` is not called (store/cache not updated)                      |
| AC2.9     | unit      | Cold-start guard fires before any API call; result contains "try again"; `saveRecipe` is not called                                                            |

### AC3: update_recipe (`src/tools/update.test.ts`)

| Criterion | Test type | Description                                                                                                                                        |
| --------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC3.1     | unit      | Provided fields are updated on the merged recipe; omitted fields retain their existing values (verified via `saveRecipe` call argument inspection) |
| AC3.2     | unit      | Providing `categories` replaces the existing category list entirely; the old UIDs are not present in the merged recipe                             |
| AC3.3     | unit      | Omitting `categories` preserves the existing category UIDs unchanged on the merged recipe                                                          |
| AC3.4     | unit      | `saveRecipe` is called exactly once with the merged recipe; `notifySync` is called exactly once (via `commitRecipe`)                               |
| AC3.5     | unit      | UID not in store returns "not found" text; `saveRecipe` is not called                                                                              |
| AC3.6     | unit      | `saveRecipe` throws -- result text contains "Failed to update" and the error message; `putRecipe` is not called                                    |
| AC3.7     | unit      | Cold-start guard fires before store lookup; result contains "try again"; `saveRecipe` is not called                                                |

### AC4: delete_recipe (`src/tools/delete.test.ts`)

| Criterion | Test type | Description                                                                                                                                                                                          |
| --------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC4.1     | unit      | Soft-delete sets `inTrash: true`; result text contains the recipe name and a confirmation mentioning "trash"; `store.get(uid).inTrash` is `true`                                                     |
| AC4.2     | unit      | `saveRecipe` is called with an argument where `inTrash === true`; `notifySync` is called exactly once (via `commitRecipe`)                                                                           |
| AC4.3     | unit      | `putRecipe` is called with the saved (trashed) recipe; `flush` is called once; store reflects the trashed recipe                                                                                     |
| AC4.4     | unit      | UID not in store returns "not found" text; `saveRecipe` is not called                                                                                                                                |
| AC4.5     | unit      | Recipe already has `inTrash: true` -- returns "already in the trash" text; `saveRecipe` is not called (store must also contain a non-trashed recipe so `store.size > 0` passes the cold-start guard) |
| AC4.6     | unit      | `saveRecipe` throws -- result text contains "Failed to delete" and the error message; `putRecipe` is not called                                                                                      |
| AC4.7     | unit      | Cold-start guard fires before store lookup; result contains "try again"                                                                                                                              |

### Helper ACs: commitRecipe and resolveCategoryNames (`src/tools/helpers.test.ts`)

| Criterion    | Test type | Description                                                                                                                                   |
| ------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| AC-helpers.1 | unit      | `resolveCategoryNames`: exact name match (case-sensitive) returns the category UID in `uids` and empty `unknown`                              |
| AC-helpers.2 | unit      | `resolveCategoryNames`: case-insensitive match (`"desserts"` matches `"Desserts"`) returns the UID in `uids`                                  |
| AC-helpers.3 | unit      | `resolveCategoryNames`: unrecognized name appears in `unknown`, not in `uids`                                                                 |
| AC-helpers.4 | unit      | `resolveCategoryNames`: mixed known/unknown names -- known go to `uids`, unknown go to `unknown`, both in input order                         |
| AC-helpers.5 | unit      | `resolveCategoryNames`: empty `names` array returns `{ uids: [], unknown: [] }`                                                               |
| AC-helpers.6 | unit      | `resolveCategoryNames`: empty `all` categories array with non-empty `names` returns all names in `unknown`                                    |
| AC-helpers.7 | unit      | `commitRecipe`: calls `putRecipe`, `flush`, `store.set`, and `notifySync` -- all four invoked exactly once                                    |
| AC-helpers.8 | unit      | `commitRecipe`: `putRecipe` is called before `flush` (verified via call-order tracking with mock implementations that push to a shared array) |
| AC-helpers.9 | unit      | `commitRecipe`: `store.set` is called with the `saved` recipe argument (not a stale pre-save copy)                                            |

---

## Human Verification Required

None. All 41 acceptance criteria are fully automatable via Vitest unit tests:

- **read_recipe** tests use a real in-memory `RecipeStore` with fixture data and `callTool()` -- no network required.
- **create_recipe**, **update_recipe**, and **delete_recipe** tests inject `vi.fn()` mocks for `saveRecipe`, `notifySync`, `putRecipe`, and `flush` via the `makeCtx` overrides parameter -- no real API or disk I/O.
- **Helper** tests exercise `resolveCategoryNames` as a pure function and `commitRecipe` with mocked dependencies.
- Cold-start guard tests use an empty (unloaded) `RecipeStore` to trigger the guard path.

---

## Verification Command

```bash
pnpm test
```
