# Human Test Plan: Paprika Type Definitions

## Prerequisites

- Node.js 24 installed (managed via mise)
- Dependencies installed: `pnpm install`
- All automated tests passing: `pnpm test -- --run` (96 tests, 0 failures)
- Typecheck passing: `pnpm typecheck` (validates all `@ts-expect-error` compile-time assertions)
- Build passing: `pnpm build` (zero errors, produces `dist/`)

## Phase 1: Branded UID Schemas and Entry Schemas

| Step | Action                                                                                            | Expected                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1  | Open `src/paprika/types.ts`. Locate `RecipeUidSchema` on line 5.                                  | Schema is `z.string().brand("RecipeUid")` -- applies a brand tag `"RecipeUid"` to parsed strings.                                                                                                                                |
| 1.2  | Locate `RecipeEntrySchema` on line 13. Verify its shape.                                          | Schema is `z.object({ uid: RecipeUidSchema, hash: z.string() })` -- `uid` field uses the branded schema, not plain `z.string()`.                                                                                                 |
| 1.3  | Open `src/paprika/types.test.ts`. Review the AC1.1 test (line 24-38).                             | Test calls `RecipeEntrySchema.safeParse({uid: "abc", hash: "def"})`, checks `success === true`, and validates both fields with exact value assertions plus structural equality via `toEqual`.                                    |
| 1.4  | Review the AC1.8 test (line 40-52).                                                               | Test calls `RecipeEntrySchema.safeParse({uid: 123, hash: "def"})`, checks `success === false`, and confirms the error is a `ZodError` instance.                                                                                  |
| 1.5  | Review the AC2.2 test (line 62-68). Verify the `@ts-expect-error` comment is on the correct line. | The `@ts-expect-error` annotation is on the line immediately before `const categoryUid: CategoryUid = recipeUid;`. This assignment should produce a type error because `RecipeUid` and `CategoryUid` carry different brand tags. |
| 1.6  | Run `pnpm typecheck`.                                                                             | Exit code 0, confirming all `@ts-expect-error` annotations are valid (each one suppresses a real compile error).                                                                                                                 |

## Phase 2: Full Object Schemas and Domain Types

| Step | Action                                                                                                                             | Expected                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1  | In `src/paprika/types.ts`, review the `RecipeSchema` transform (lines 59-91). Count the number of snake_case fields being renamed. | Exactly 13 fields are renamed: `image_url`, `prep_time`, `cook_time`, `total_time`, `photo_hash`, `photo_large`, `photo_url`, `source_url`, `on_favorites`, `in_trash`, `is_pinned`, `on_grocery_list`, `nutritional_info`. Remaining fields pass through via `...rest`.            |
| 2.2  | Review the AC1.2 test (line 117-182) in the test file. Verify it checks all 13 renamed fields.                                     | Test explicitly asserts the camelCase value for each renamed field: `imageUrl`, `prepTime`, `cookTime`, `totalTime`, `photoHash`, `photoLarge`, `photoUrl`, `sourceUrl`, `onFavorites`, `inTrash`, `isPinned`, `onGroceryList`, `nutritionalInfo`. Also asserts 8 unchanged fields. |
| 2.3  | Review the `RecipeInput` type definition on line 121-124 of `types.ts`.                                                            | Uses `SetRequired<Partial<Omit<Recipe, "uid" \| "hash" \| "created">>, "name" \| "ingredients" \| "directions">`. This omits server-assigned fields, makes everything optional, then re-requires the three essential fields.                                                        |
| 2.4  | Review the AC3.2 test (line 432-449).                                                                                              | Uses conditional types to prove `"uid"`, `"hash"`, and `"created"` are not in `keyof RecipeInput`. If any were present, the conditional resolves to `never` and the `const _check: AssertNoX = true` assignment fails at compile time.                                              |
| 2.5  | Review `SyncResult` and `DiffResult` type definitions (lines 126-136 of `types.ts`). Verify readonly modifiers.                    | Both types use `readonly` on all properties and `ReadonlyArray<>` for array types, preventing mutation.                                                                                                                                                                             |

## Phase 3: Error Class Hierarchy

| Step | Action                                                                                                               | Expected                                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1  | Open `src/paprika/errors.ts`. Review the class hierarchy.                                                            | Three classes: `PaprikaError extends Error`, `PaprikaAuthError extends PaprikaError`, `PaprikaAPIError extends PaprikaError`. All accept `ErrorOptions` in their constructors.                                                    |
| 3.2  | Verify `PaprikaAPIError` message formatting on line 47.                                                              | Constructor calls `super(\`\${message} (HTTP \${status} from \${endpoint})\`)`. This produces the format `"message (HTTP N from /path)"`.                                                                                         |
| 3.3  | Verify `readonly` on `status` and `endpoint` fields (lines 43-44).                                                   | Both fields declared as `readonly status: number` and `readonly endpoint: string`.                                                                                                                                                |
| 3.4  | Verify `PaprikaAuthError` default message (line 29).                                                                 | Constructor parameter defaults to `"Authentication failed"` when no message is provided.                                                                                                                                          |
| 3.5  | Review AC4.4 tests (line 68-131 of `errors.test.ts`). Confirm all three error classes are tested for cause chaining. | Five test cases: `PaprikaError` with cause, `PaprikaAuthError` with custom message + cause, `PaprikaAuthError` with `undefined` message + cause (testing default), `PaprikaAPIError` with cause, and a multi-level chaining test. |

## End-to-End: Schema-to-Type Pipeline

**Purpose:** Validate that the full pipeline from raw API wire format through Zod parsing to typed TypeScript output works correctly and maintains type safety across boundaries.

| Step | Action                                                                                                  | Expected                                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| E1   | Run `pnpm test -- --run` from the project root.                                                         | 96 tests pass across 4 test files (src and dist copies of both test files).                                       |
| E2   | Run `pnpm typecheck` from the project root.                                                             | Exit code 0, meaning all 7 `@ts-expect-error` annotations in `types.test.ts` and 2 in `errors.test.ts` are valid. |
| E3   | Run `pnpm build` from the project root.                                                                 | Exit code 0. `dist/` directory contains compiled `.js` files for both `types.ts` and `errors.ts`.                 |
| E4   | Verify that test files in `dist/` also pass by observing vitest ran both `src/` and `dist/` test files. | The test output shows 4 test files.                                                                               |

## End-to-End: Brand Safety Across Modules

**Purpose:** Validate that branded UIDs prevent accidental cross-assignment between recipe and category identifiers at the type system level.

| Step | Action                                                                                                                                     | Expected                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| B1   | Open `src/paprika/types.test.ts`. Locate the three compile-time brand safety tests (AC2.1 at line 54, AC2.2 at line 62, AC2.3 at line 71). | All three tests are present.                                                     |
| B2   | Verify AC2.1: `RecipeUidSchema.parse("test-uid")` result is assigned to `variable: RecipeUid` -- no `@ts-expect-error`.                    | Confirms the assignment is valid.                                                |
| B3   | Verify AC2.2: Assignment of `RecipeUid` to `CategoryUid` has `@ts-expect-error`.                                                           | Confirms cross-assignment is blocked.                                            |
| B4   | Verify AC2.3: Assignment of plain `string` to `RecipeUid` has `@ts-expect-error`.                                                          | Confirms unbranded strings cannot bypass the schema.                             |
| B5   | Run `pnpm typecheck` and confirm exit code 0.                                                                                              | All annotations are valid.                                                       |
| B6   | Temporarily remove one `@ts-expect-error` annotation (e.g., the one on line 65). Run `pnpm typecheck` again.                               | It fails with a type error about the invalid assignment. Restore the annotation. |

## Human Verification Required

The test requirements document states that all acceptance criteria can be fully automated, and no human verification is required. However, the following items benefit from human review:

| Criterion                        | Why Manual                                                                                                                                                                     | Steps                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema completeness vs. real API | Automated tests verify the schema shape, but cannot confirm it matches the actual Paprika API response format without hitting the live API.                                    | Compare the 28 fields in `RecipeSchema` against the Paprika API documentation or a real API response. Verify no fields are missing or extraneous.            |
| Error message readability        | The formatted message `"msg (HTTP N from /path)"` is tested for correctness, but human judgment is needed to confirm the format is useful for debugging.                       | Create a `PaprikaAPIError("Recipe not found", 404, "/api/v2/sync/recipe/abc-123/")` in a REPL and inspect the `.message` output. Confirm it reads naturally. |
| RecipeInput usability            | The type is structurally correct per automated tests, but manual review should confirm the required/optional split makes sense for the application's recipe creation workflow. | Review `src/paprika/types.ts` lines 121-124. Confirm that requiring only `name`, `ingredients`, and `directions` aligns with the minimum viable recipe.      |

## Traceability

| Acceptance Criterion                                     | Automated Test            | Manual Step |
| -------------------------------------------------------- | ------------------------- | ----------- |
| AC1.1 RecipeEntrySchema parses valid input               | `types.test.ts` line 24   | 1.3         |
| AC1.2 RecipeSchema snake_case to camelCase               | `types.test.ts` line 117  | 2.1-2.2     |
| AC1.3 Recipe.imageUrl is string                          | `types.test.ts` line 184  | 2.1         |
| AC1.4 Recipe.categories is CategoryUid[]                 | `types.test.ts` line 232  | 2.1         |
| AC1.5 CategorySchema camelCase output                    | `types.test.ts` line 283  | 2.1         |
| AC1.6 AuthResponseSchema nested token                    | `types.test.ts` line 323  | 2.1         |
| AC1.7 RecipeSchema rejects missing fields                | `types.test.ts` line 340  | 1.4         |
| AC1.8 RecipeEntrySchema rejects non-string uid           | `types.test.ts` line 40   | 1.4         |
| AC2.1 RecipeUid assignable to RecipeUid                  | `types.test.ts` line 54   | B2          |
| AC2.2 RecipeUid not assignable to CategoryUid            | `types.test.ts` line 62   | B3, B6      |
| AC2.3 Plain string not assignable to RecipeUid           | `types.test.ts` line 71   | B4          |
| AC3.1 RecipeInput requires name, ingredients, directions | `types.test.ts` line 393  | 2.3         |
| AC3.2 RecipeInput excludes uid, hash, created            | `types.test.ts` line 432  | 2.4         |
| AC3.3 SyncResult shape                                   | `types.test.ts` line 452  | 2.5         |
| AC3.4 DiffResult shape                                   | `types.test.ts` line 480  | 2.5         |
| AC4.1 Inheritance chain                                  | `errors.test.ts` line 5   | 3.1         |
| AC4.2 readonly status and endpoint                       | `errors.test.ts` line 27  | 3.3         |
| AC4.3 Message format                                     | `errors.test.ts` line 52  | 3.2         |
| AC4.4 ErrorOptions cause chaining                        | `errors.test.ts` line 68  | 3.5         |
| AC4.5 Error name property                                | `errors.test.ts` line 133 | 3.1         |
| AC5.1 pnpm build passes                                  | Build verification        | E3          |
| AC5.2 pnpm typecheck passes                              | Build verification        | E2          |
| AC5.3 All exports from types.ts                          | `types.test.ts` line 1-21 | E1          |
| AC5.4 All exports from errors.ts                         | `errors.test.ts` line 2   | E1          |
