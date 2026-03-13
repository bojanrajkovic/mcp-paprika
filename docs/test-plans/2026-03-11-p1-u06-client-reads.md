# Human Test Plan: P1-U06 PaprikaClient Read Operations

## Prerequisites

- Node.js 24 installed (managed via `mise`)
- `pnpm install` has been run (git hooks active)
- All automated tests pass: `pnpm test` (245 tests passing)
- Typecheck passes: `pnpm typecheck` (exits 0)

## Phase 1: Recipe Read Operations

| Step | Action                                                                               | Expected                                                                                                                                              |
| ---- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Open `src/paprika/client.ts` and locate the `const API_BASE =` declaration (line 28) | No `@ts-expect-error` or `eslint-disable` comment appears on the lines immediately above it                                                           |
| 2    | In the same file, locate the `private async request<T>(` declaration (line 109)      | No `@ts-expect-error` comment appears on the line immediately above it                                                                                |
| 3    | Verify `listRecipes()` signature at line 86                                          | Method returns `Promise<Array<RecipeEntry>>` with explicit return type annotation                                                                     |
| 4    | Verify `getRecipe()` signature at line 90                                            | Method returns `Promise<Recipe>` with explicit return type annotation                                                                                 |
| 5    | Verify imports include type-only imports at line 23                                  | `import type { Category, Recipe, RecipeEntry } from "./types.js"` is present                                                                          |
| 6    | Verify the module-level doc comment (lines 1-9)                                      | Comment mentions "Provides recipe and category read methods" and "Category write methods are deferred to P1-U07" (no stale "deferred to P1-U06" text) |

## Phase 2: Batch and Category Operations

| Step | Action                                                                                                    | Expected                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1    | Verify `getRecipes()` signature at line 94                                                                | Accepts `ReadonlyArray<string>`, returns `Promise<Array<Recipe>>`                                    |
| 2    | Verify `getRecipes()` uses `_recipesBulkhead` at line 95                                                  | Each `getRecipe` call is wrapped in `this._recipesBulkhead.execute()`                                |
| 3    | Verify `listCategories()` signature at line 98                                                            | Returns `Promise<Array<Category>>`                                                                   |
| 4    | Verify `listCategories()` uses `_categoriesBulkhead` at line 102                                          | Each category hydration call is wrapped in `this._categoriesBulkhead.execute()`                      |
| 5    | Verify both bulkhead instances are constructed with `bulkhead(5, Number.MAX_SAFE_INTEGER)` at lines 63-64 | Two separate `readonly` bulkhead fields exist with limit 5, confirming independent concurrency pools |
| 6    | Verify `CategoryEntrySchema` and `CategorySchema` are imported at line 24                                 | Both schemas used for list-then-hydrate pattern in `listCategories()`                                |

## End-to-End: Full Recipe Read Flow

**Purpose:** Validates that `listRecipes` → `getRecipes` compose correctly, including schema validation at every boundary.

| Step | Action                                                                                                                         | Expected                                                                                                                                                                                                   |
| ---- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | In `src/paprika/client.test.ts`, verify that `makeSnakeCaseRecipe()` (lines 11–42) includes all snake_case fields from the API | Fields include `prep_time`, `cook_time`, `total_time`, `image_url`, `photo_hash`, `photo_large`, `photo_url`, `source_url`, `on_favorites`, `in_trash`, `is_pinned`, `on_grocery_list`, `nutritional_info` |
| 2    | Run `pnpm test -- src/paprika/client.test.ts` and confirm 22 tests pass                                                        | Output shows "22 passed" with no failures or skips                                                                                                                                                         |
| 3    | Run `pnpm typecheck` and confirm zero errors                                                                                   | Exit code 0, no output                                                                                                                                                                                     |

## End-to-End: Category List-then-Hydrate Flow

**Purpose:** Validates that the two-step pattern (list entries, then hydrate each) works correctly with independent concurrency control.

| Step | Action                                                                                                                            | Expected                                                                                                  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 1    | In `client.ts` line 99, verify `listCategories()` first calls `this.request("GET", ..., z.array(CategoryEntrySchema))`            | Entry list is fetched and validated as `CategoryEntry[]`                                                  |
| 2    | In `client.ts` lines 100–106, verify each entry is hydrated via `this.request("GET", .../category/${entry.uid}/, CategorySchema)` | Individual category objects are fetched using `entry.uid` from the list response                          |
| 3    | Confirm that `_categoriesBulkhead` (line 64) is a separate instance from `_recipesBulkhead` (line 63)                             | Two distinct `bulkhead(5, ...)` calls as class field initializers, ensuring independent concurrency pools |

## Human Verification Required

| Criterion                                                            | Why Manual                                                                                                              | Steps                                                                                                                 |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| AC5.1: `@ts-expect-error` and `eslint-disable` on `API_BASE` removed | `pnpm typecheck` confirms the comments are unnecessary, but only visual inspection confirms they are physically deleted | Open `src/paprika/client.ts`, go to line 28 (`const API_BASE = ...`), confirm no suppression comments on lines 26–27  |
| AC5.2: `@ts-expect-error` on `request()` removed                     | Same rationale as AC5.1                                                                                                 | Open `src/paprika/client.ts`, go to line 109 (`private async request<T>(`), confirm no `@ts-expect-error` on line 108 |

## Traceability

| Acceptance Criterion                                     | Automated Test            | Manual Step                         |
| -------------------------------------------------------- | ------------------------- | ----------------------------------- |
| AC1.1: `listRecipes()` returns `RecipeEntry[]`           | `client.test.ts` line 207 | Phase 1 Step 3                      |
| AC1.2: Empty list returns `[]`                           | `client.test.ts` line 229 | —                                   |
| AC2.1: `getRecipe()` returns camelCase `Recipe`          | `client.test.ts` line 244 | Phase 1 Step 4                      |
| AC2.2: Non-2xx throws `PaprikaAPIError`                  | `client.test.ts` line 260 | —                                   |
| AC3.1: `getRecipes()` preserves order                    | `client.test.ts` line 305 | Phase 2 Step 1                      |
| AC3.2: `getRecipes([])` returns `[]`, no HTTP            | `client.test.ts` line 321 | —                                   |
| AC3.3: Concurrency limited to 5                          | `client.test.ts` line 329 | Phase 2 Step 2                      |
| AC3.4: Single failure rejects entire batch               | `client.test.ts` line 350 | —                                   |
| AC4.1: `listCategories()` returns camelCase `Category[]` | `client.test.ts` line 372 | Phase 2 Step 3                      |
| AC4.2: 1 list + N hydration requests                     | `client.test.ts` line 398 | E2E Category Steps 1–2              |
| AC4.3: Empty list, no hydration                          | `client.test.ts` line 433 | —                                   |
| AC4.4: Independent bulkheads at 5                        | `client.test.ts` line 446 | Phase 2 Step 5, E2E Category Step 3 |
| AC5.1: `API_BASE` suppressions removed                   | `pnpm typecheck`          | Human Verification Row 1            |
| AC5.2: `request()` suppression removed                   | `pnpm typecheck`          | Human Verification Row 2            |
| AC5.3: TypeScript compiles cleanly                       | `pnpm typecheck`          | E2E Recipe Step 3                   |
