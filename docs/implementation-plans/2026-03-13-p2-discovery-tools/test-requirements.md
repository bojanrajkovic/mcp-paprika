# Test Requirements: p2-discovery-tools

## Summary

This document maps every acceptance criterion from the p2-discovery-tools design plan to either an automated test or a documented human verification approach. The four discovery tools (`search_recipes`, `filter_by_ingredient`, `filter_by_time`, `list_categories`) are implemented across three phases, each with a dedicated test file. Cross-cutting criteria (AC5) are verified structurally by code shape and import analysis rather than dedicated test cases.

All automated tests are unit tests using vitest with real `RecipeStore` instances populated with fixture data. No network mocking is needed because these tools make zero API calls at query time. Shared test utilities (`makeTestServer`, `makeCtx`, `getText`) live in `src/tools/tool-test-utils.ts` and are used by all three test files.

**Test counts by file:**

- `src/tools/search.test.ts` -- 6 tests (AC1.1-AC1.6)
- `src/tools/filter.test.ts` -- 15 tests (AC2.1-AC2.6, AC3.1-AC3.8, plus 1 additional for invalid duration input)
- `src/tools/categories.test.ts` -- 5 tests (AC4.1-AC4.5)

**Total: 26 automated tests, 3 human verification items (AC5.1-AC5.3)**

## AC Coverage Map

### AC1: search_recipes

| AC                       | Type | File                     | Test Name/Description                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ---- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p2-discovery-tools.AC1.1 | unit | src/tools/search.test.ts | `p2-discovery-tools.AC1.1: non-empty store + matching query returns formatted results` -- Loads a recipe named "Chocolate Cake", searches for "chocolate", asserts result text contains the recipe name.                                                                                                               |
| p2-discovery-tools.AC1.2 | unit | src/tools/search.test.ts | `p2-discovery-tools.AC1.2: limit defaults to 20 when store has many matches` -- Loads 25 recipes all matching "recipe", passes `limit: 20` (the Zod default value), asserts exactly 19 `---` separators (20 results). The Zod `.default(20)` guarantee is structural; the test confirms behavior at the default value. |
| p2-discovery-tools.AC1.3 | unit | src/tools/search.test.ts | `p2-discovery-tools.AC1.3: limit caps result count` -- Loads 10 matching recipes, passes `limit: 3`, asserts exactly 2 separators (3 results).                                                                                                                                                                         |
| p2-discovery-tools.AC1.4 | unit | src/tools/search.test.ts | `p2-discovery-tools.AC1.4: category names appear in formatted results` -- Loads a recipe with a "Dessert" category UID, asserts the resolved name "Dessert" appears in the output text.                                                                                                                                |
| p2-discovery-tools.AC1.5 | unit | src/tools/search.test.ts | `p2-discovery-tools.AC1.5: empty store returns cold-start Err payload` -- Creates a `RecipeStore` without calling `load()` (size === 0), asserts the result text contains "try again".                                                                                                                                 |
| p2-discovery-tools.AC1.6 | unit | src/tools/search.test.ts | `p2-discovery-tools.AC1.6: no matching recipes returns empty-result message (not an error)` -- Loads "Pasta Carbonara", searches for "sushi", asserts `isError` is falsy and text contains "no recipes".                                                                                                               |

### AC2: filter_by_ingredient

| AC                       | Type | File                     | Test Name/Description                                                                                                                                                                                                                                     |
| ------------------------ | ---- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p2-discovery-tools.AC2.1 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC2.1: mode=all returns only recipes with all ingredients` -- Loads three recipes with different ingredient combinations, filters with `mode: "all"` for ["tomato", "garlic"], asserts only the recipe containing both appears.       |
| p2-discovery-tools.AC2.2 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC2.2: mode=any returns recipes with any ingredient` -- Filters with `mode: "any"` for ["tomato", "garlic"], asserts recipes containing either ingredient appear but a recipe with neither does not.                                  |
| p2-discovery-tools.AC2.3 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC2.3: mode defaults to all (pass mode: all explicitly in test)` -- Passes `mode: "all"` explicitly (the Zod default), verifies that only the recipe with both ingredients appears. The default mechanism is structural (Zod schema). |
| p2-discovery-tools.AC2.4 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC2.4: limit caps results (using explicit limit=20)` -- Loads 25 recipes all containing "tomato", passes `limit: 20`, asserts exactly 19 separators (20 results).                                                                     |
| p2-discovery-tools.AC2.5 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC2.5: empty store returns cold-start Err payload` -- Unloaded store, asserts result text contains "try again".                                                                                                                       |
| p2-discovery-tools.AC2.6 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC2.6: no matching recipes returns empty-result message` -- Loads a recipe with "pasta, tomato", filters for "sushi", asserts `isError` is falsy and text contains "no recipes".                                                      |

### AC3: filter_by_time

| AC                       | Type | File                     | Test Name/Description                                                                                                                                                                                                                                                      |
| ------------------------ | ---- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p2-discovery-tools.AC3.1 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC3.1: maxTotalTime returns only recipes with totalTime <= constraint` -- Loads recipes with 20 min, 45 min, and 2 hours total time; filters with `maxTotalTime: "30 minutes"`; asserts only the 20 min recipe appears.                                |
| p2-discovery-tools.AC3.2 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC3.2: maxPrepTime returns only recipes with prepTime <= constraint` -- Loads recipes with 10 min and 1 hour prep time; filters with `maxPrepTime: "15 minutes"`; asserts only QuickPrep appears.                                                      |
| p2-discovery-tools.AC3.3 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC3.3: maxCookTime returns only recipes with cookTime <= constraint` -- Loads recipes with 15 min and 3 hours cook time; filters with `maxCookTime: "30 min"`; asserts only QuickCook appears.                                                         |
| p2-discovery-tools.AC3.4 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC3.4: results ordered by total time ascending` -- Loads three recipes in scrambled order (60 min, 10 min, 30 min); asserts the text positions appear in ascending order: Fast < Medium < Slow.                                                        |
| p2-discovery-tools.AC3.5 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC3.5: limit applied post-store (at most limit results)` -- Loads 10 matching recipes, passes `limit: 3`, asserts exactly 2 separators (3 results). Confirms `.slice(0, limit)` is applied after the store call.                                       |
| p2-discovery-tools.AC3.6 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC3.6: all constraints optional -- no constraints returns all recipes sorted by time` -- Calls with only `{ limit: 20 }` (no time constraints), asserts both loaded recipes appear in the output.                                                      |
| p2-discovery-tools.AC3.7 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC3.7: empty store returns cold-start Err payload` -- Unloaded store, asserts result text contains "try again".                                                                                                                                        |
| p2-discovery-tools.AC3.8 | unit | src/tools/filter.test.ts | `p2-discovery-tools.AC3.8: no recipes match constraints returns empty-result message` -- Loads a recipe with 4 hours total time, filters with `maxTotalTime: "10 minutes"`, asserts `isError` is falsy and text contains "no recipes".                                     |
| (additional)             | unit | src/tools/filter.test.ts | `invalid duration string returns user-friendly error message` -- Passes `maxTotalTime: "not a time"`, asserts the result text contains "invalid". Exercises the `parseMaybeMinutes()` Err path which is not covered by any AC but is an important error-handling boundary. |

### AC4: list_categories

| AC                       | Type | File                         | Test Name/Description                                                                                                                                                                                                                                 |
| ------------------------ | ---- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| p2-discovery-tools.AC4.1 | unit | src/tools/categories.test.ts | `p2-discovery-tools.AC4.1: returns all categories with non-trashed recipe counts` -- Loads two categories, four recipes (one trashed), asserts Desserts shows "2 recipes" (trashed excluded) and Mains shows "1 recipe".                              |
| p2-discovery-tools.AC4.2 | unit | src/tools/categories.test.ts | `p2-discovery-tools.AC4.2: categories sorted alphabetically by name` -- Loads categories in reverse order (Zucchini, Appetizers, Main Courses), asserts text positions appear alphabetically: Appetizers < Main Courses < Zucchini.                   |
| p2-discovery-tools.AC4.3 | unit | src/tools/categories.test.ts | `p2-discovery-tools.AC4.3: category with zero non-trashed recipes appears with count 0` -- Loads "Empty Category" (no recipes reference it) and "Full Category" (one recipe references it), asserts both appear and Empty Category shows "0 recipes". |
| p2-discovery-tools.AC4.4 | unit | src/tools/categories.test.ts | `p2-discovery-tools.AC4.4: empty store returns cold-start Err payload` -- Unloaded store, asserts result text contains "try again".                                                                                                                   |
| p2-discovery-tools.AC4.5 | unit | src/tools/categories.test.ts | `p2-discovery-tools.AC4.5: store with recipes but no categories returns empty message` -- Loads one recipe with an empty categories array and no categories, asserts `isError` is falsy and text contains "no categories".                            |

### AC5: Cross-cutting

| AC                       | Verification       | Justification                      |
| ------------------------ | ------------------ | ---------------------------------- |
| p2-discovery-tools.AC5.1 | Structural (human) | See Human Verification Items below |
| p2-discovery-tools.AC5.2 | Structural (human) | See Human Verification Items below |
| p2-discovery-tools.AC5.3 | Structural (human) | See Human Verification Items below |

## Human Verification Items

The following acceptance criteria are verified structurally by inspecting code shape and imports. They cannot be meaningfully automated because they constrain _how_ the code is written rather than _what it produces_. A unit test could only assert the same observable behavior that the functional AC1-AC4 tests already cover; what AC5 adds is a constraint on implementation strategy.

### p2-discovery-tools.AC5.1: All four tools registered via `registerTool()` with raw `ZodRawShape`

**Why not automated:** The criterion requires that `inputSchema` is passed as a raw object literal (`{ query: z.string(), ... }`) rather than wrapped in `z.object()`. Both approaches produce identical runtime behavior, so a test cannot distinguish them. The constraint exists to follow the SDK's documented API convention.

**Verification approach:**

1. Open each tool file: `src/tools/search.ts`, `src/tools/filter.ts`, `src/tools/categories.ts`
2. Confirm each `server.registerTool()` call passes `inputSchema` as a plain object with Zod fields (e.g., `{ query: z.string(), limit: z.number()... }`)
3. Confirm there is no `z.object()` wrapper around the input schema

### p2-discovery-tools.AC5.2: All four tool handlers use `coldStartGuard(ctx).match(okFn, errFn)` pattern

**Why not automated:** The cold-start guard's observable effect (returning "try again" for empty stores) is already tested by AC1.5, AC2.5, AC3.7, and AC4.4. This criterion additionally requires that the _idiomatic `.match()` pattern_ is used rather than an imperative `.isOk()` / `.isErr()` check. Both produce identical output, so a test cannot distinguish them. The constraint enforces the codebase's neverthrow style rule.

**Verification approach:**

1. Open each tool file: `src/tools/search.ts`, `src/tools/filter.ts`, `src/tools/categories.ts`
2. Confirm each handler body contains `coldStartGuard(ctx).match(` followed by an async Ok branch and a `(guard) => guard` Err branch
3. Confirm there are no `.isOk()` or `.isErr()` calls anywhere in the tool files

### p2-discovery-tools.AC5.3: No handler calls `PaprikaClient` directly

**Why not automated:** The criterion constrains imports, not behavior. A handler that called `PaprikaClient` could theoretically produce the same results in tests (with appropriate mocking), so the constraint is about architectural boundaries, not observable output. The test stub `ServerContext` already has a stub `client` that would fail if called, but the absence of a `PaprikaClient` import is what the AC requires.

**Verification approach:**

1. Open each tool file: `src/tools/search.ts`, `src/tools/filter.ts`, `src/tools/categories.ts`
2. Confirm no runtime imports from `../paprika/` (type-only imports like `import type { Recipe }` are allowed)
3. Confirm handler bodies reference only `ctx.store` methods, never `ctx.client`
4. Search the tool files for `PaprikaClient`, `paprikaClient`, or `client.` references (excluding type imports) and confirm zero matches
