# Paprika Type Definitions -- Test Requirements

Maps every acceptance criterion from the [design plan](../../design-plans/2026-03-03-paprika-types.md) to specific automated tests or human verification steps.

---

## Automated Test Requirements

### AC1: Zod schemas validate API responses

#### AC1.1 -- RecipeEntrySchema parses `{uid: "abc", hash: "def"}` and returns branded RecipeUid

- **Test type:** Unit
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 1 (Task 3)
- **Description:** Parse `{uid: "abc", hash: "def"}` through `RecipeEntrySchema`. Assert the parse succeeds, the returned `uid` field equals `"abc"`, and the result has both `uid` and `hash` fields with the expected values.

#### AC1.2 -- RecipeSchema parses a full snake_case API response and outputs camelCase fields

- **Test type:** Unit
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 3)
- **Description:** Construct a complete 28-field snake_case recipe object. Parse through `RecipeSchema`. Assert that all snake_case fields are renamed to camelCase in the output (`image_url` becomes `imageUrl`, `prep_time` becomes `prepTime`, `cook_time` becomes `cookTime`, `total_time` becomes `totalTime`, `photo_hash` becomes `photoHash`, `photo_large` becomes `photoLarge`, `photo_url` becomes `photoUrl`, `source_url` becomes `sourceUrl`, `on_favorites` becomes `onFavorites`, `in_trash` becomes `inTrash`, `is_pinned` becomes `isPinned`, `on_grocery_list` becomes `onGroceryList`, `nutritional_info` becomes `nutritionalInfo`). Assert that fields that do not change names (`uid`, `hash`, `name`, `categories`, `ingredients`, `directions`, etc.) are still present with correct values.

#### AC1.3 -- Recipe.imageUrl is `string` (non-optional, non-nullable)

- **Test type:** Compile-time
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 3)
- **Description:** After parsing a valid recipe, assert at runtime that `result.imageUrl` is a string. Use `// @ts-expect-error` to verify that assigning `null` to a variable typed `Recipe["imageUrl"]` produces a compile error. The `pnpm typecheck` command validates the `@ts-expect-error` annotation -- if `null` were actually assignable, the annotation would be flagged as unnecessary and typecheck would fail.

#### AC1.4 -- Recipe.categories is `CategoryUid[]` (branded, not plain string)

- **Test type:** Compile-time
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 3)
- **Description:** Parse a recipe with `categories: ["cat-1", "cat-2"]`. Assert at runtime that the parsed `categories` is an array. Use `// @ts-expect-error` to verify that assigning a plain `string` to a variable typed `Recipe["categories"][number]` produces a compile error, confirming the array elements carry the `CategoryUid` brand.

#### AC1.5 -- CategorySchema parses `{uid, name, order_flag, parent_uid}` with camelCase output

- **Test type:** Unit
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 3)
- **Description:** Parse `{uid: "cat-1", name: "Desserts", order_flag: 0, parent_uid: null}` through `CategorySchema`. Assert the output has `orderFlag` (not `order_flag`) and `parentUid` (not `parent_uid`). Assert all values are preserved correctly.

#### AC1.6 -- AuthResponseSchema parses `{result: {token: "..."}}`

- **Test type:** Unit
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 3)
- **Description:** Parse `{result: {token: "test-jwt-token"}}` through `AuthResponseSchema`. Assert the parsed `result.result.token` equals `"test-jwt-token"`.

#### AC1.7 -- RecipeSchema rejects response missing required fields

- **Test type:** Unit
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 3)
- **Description:** Attempt to parse an object missing required fields (e.g., missing `name` and `ingredients`) through `RecipeSchema`. Assert it throws a `ZodError`.

#### AC1.8 -- RecipeEntrySchema rejects response with non-string uid

- **Test type:** Unit
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 1 (Task 3)
- **Description:** Parse `{uid: 123, hash: "def"}` through `RecipeEntrySchema`. Assert it throws a `ZodError` because `uid` must be a string.

---

### AC2: Branded UIDs prevent cross-assignment

#### AC2.1 -- RecipeUid assignable to variables typed RecipeUid

- **Test type:** Compile-time
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 1 (Task 3)
- **Description:** Parse a string through `RecipeUidSchema` and assign the result to a variable explicitly typed as `RecipeUid`. The test file compiling without errors (verified by `pnpm typecheck`) proves the assignment is valid.

#### AC2.2 -- RecipeUid not assignable to CategoryUid (compile error)

- **Test type:** Compile-time
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 1 (Task 3)
- **Description:** Use `// @ts-expect-error` before assigning a `RecipeUid` value to a variable typed `CategoryUid`. The `pnpm typecheck` command validates this -- if the `@ts-expect-error` is unnecessary (meaning the assignment is actually allowed), typecheck fails with an error about an unused directive.

#### AC2.3 -- Plain string not assignable to RecipeUid without parsing through schema

- **Test type:** Compile-time
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 1 (Task 3)
- **Description:** Use `// @ts-expect-error` before assigning a plain `string` literal to a variable typed `RecipeUid`. The `pnpm typecheck` command validates this -- if a plain string were assignable to a branded type, the annotation would be flagged as unnecessary.

---

### AC3: Domain types are correctly shaped

#### AC3.1 -- RecipeInput requires name, ingredients, directions; all other fields optional

- **Test type:** Compile-time
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 5)
- **Description:** Assert that `{name: "x", ingredients: "y", directions: "z"}` satisfies `RecipeInput` (minimum required fields compile). Use `// @ts-expect-error` to verify that an object missing `name` does NOT satisfy `RecipeInput`.

#### AC3.2 -- RecipeInput excludes uid, hash, created

- **Test type:** Compile-time
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 5)
- **Description:** Use conditional type assertions to verify excluded keys are not in `RecipeInput`:
  ```typescript
  type AssertNoUid = "uid" extends keyof RecipeInput ? never : true;
  type AssertNoHash = "hash" extends keyof RecipeInput ? never : true;
  type AssertNoCreated = "created" extends keyof RecipeInput ? never : true;
  const _checkNoUid: AssertNoUid = true;
  const _checkNoHash: AssertNoHash = true;
  const _checkNoCreated: AssertNoCreated = true;
  ```
  If any excluded key is present in `RecipeInput`, the conditional type resolves to `never` and the assignment to `true` fails at compile time. Verified by `pnpm typecheck`.

#### AC3.3 -- SyncResult has added: Recipe[], updated: Recipe[], removedUids: string[]

- **Test type:** Compile-time
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 5)
- **Description:** Assert that `{added: [], updated: [], removedUids: []}` satisfies `SyncResult`. The `satisfies` keyword ensures structural compatibility at compile time, verified by `pnpm typecheck`.

#### AC3.4 -- DiffResult has added: string[], changed: string[], removed: string[]

- **Test type:** Compile-time
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 2 (Task 5)
- **Description:** Assert that `{added: [], changed: [], removed: []}` satisfies `DiffResult`. The `satisfies` keyword ensures structural compatibility at compile time, verified by `pnpm typecheck`.

---

### AC4: Error classes have correct hierarchy and fields

#### AC4.1 -- PaprikaAuthError instanceof PaprikaError instanceof Error

- **Test type:** Unit
- **Test file:** `src/paprika/errors.test.ts`
- **Phase:** 3 (Task 2)
- **Description:** Create a `PaprikaAuthError` instance. Assert `instanceof PaprikaAuthError`, `instanceof PaprikaError`, and `instanceof Error` are all `true`. Repeat for `PaprikaAPIError` (assert `instanceof PaprikaAPIError`, `instanceof PaprikaError`, `instanceof Error`).

#### AC4.2 -- PaprikaAPIError exposes readonly status: number and endpoint: string

- **Test type:** Unit + Compile-time
- **Test file:** `src/paprika/errors.test.ts`
- **Phase:** 3 (Task 2)
- **Description:** Create `new PaprikaAPIError("Not found", 404, "/api/v2/sync/recipe/abc/")`. Assert `error.status === 404` and `error.endpoint === "/api/v2/sync/recipe/abc/"` at runtime. Use `// @ts-expect-error` to verify that assignment to `error.status` and `error.endpoint` produces compile errors (confirming they are `readonly`). Verified by `pnpm typecheck` for the compile-time portion.

#### AC4.3 -- PaprikaAPIError formats message as "message (HTTP status from endpoint)"

- **Test type:** Unit
- **Test file:** `src/paprika/errors.test.ts`
- **Phase:** 3 (Task 2)
- **Description:** Create `new PaprikaAPIError("Not found", 404, "/api/v2/sync/recipe/abc/")`. Assert `error.message` equals `"Not found (HTTP 404 from /api/v2/sync/recipe/abc/)"`.

#### AC4.4 -- All error classes accept ErrorOptions for cause chaining

- **Test type:** Unit
- **Test file:** `src/paprika/errors.test.ts`
- **Phase:** 3 (Task 2)
- **Description:** For each error class, construct an instance with `{ cause: new Error("original") }` as the options argument. Assert `error.cause instanceof Error` and `(error.cause as Error).message === "original"`. Also test `PaprikaAuthError` with default message plus cause: `new PaprikaAuthError(undefined, { cause: original })`.

#### AC4.5 -- Each error class sets this.name to match its class name

- **Test type:** Unit
- **Test file:** `src/paprika/errors.test.ts`
- **Phase:** 3 (Task 2)
- **Description:** Assert `new PaprikaError("x").name === "PaprikaError"`, `new PaprikaAuthError().name === "PaprikaAuthError"`, `new PaprikaAPIError("x", 500, "/").name === "PaprikaAPIError"`.

---

### AC5: Build and exports

#### AC5.1 -- pnpm build compiles with zero errors

- **Test type:** Build verification (CI)
- **Test file:** N/A (verified by running `pnpm build`)
- **Phase:** All phases (verified at end of each phase)
- **Description:** Run `pnpm build` and assert the exit code is 0. This is verified at each phase boundary. In CI, this is part of the standard build step.

#### AC5.2 -- pnpm typecheck passes

- **Test type:** Build verification (CI)
- **Test file:** N/A (verified by running `pnpm typecheck`)
- **Phase:** All phases (verified at end of each phase)
- **Description:** Run `pnpm typecheck` (`tsc --noEmit`) and assert the exit code is 0. This command also validates all `@ts-expect-error` annotations in test files -- if any annotation is unnecessary (meaning the expected error does not occur), typecheck itself fails. This is the mechanism that turns compile-time type assertions in test files into verifiable CI checks.

#### AC5.3 -- All schemas and types are named exports from src/paprika/types.ts

- **Test type:** Unit
- **Test file:** `src/paprika/types.test.ts`
- **Phase:** 1 (Task 2) and 2 (Tasks 1-4)
- **Description:** Verified implicitly by the test file importing all schemas and types by name from `src/paprika/types.ts`. If any expected export is missing, the test file fails to compile. This is caught by `pnpm typecheck`. The specific exports that must be importable are: `RecipeUidSchema`, `CategoryUidSchema`, `RecipeUid`, `CategoryUid`, `RecipeEntrySchema`, `CategoryEntrySchema`, `RecipeEntry`, `CategoryEntry`, `RecipeSchema`, `Recipe`, `CategorySchema`, `Category`, `AuthResponseSchema`, `AuthResponse`, `RecipeInput`, `SyncResult`, `DiffResult`.

#### AC5.4 -- All error classes are named exports from src/paprika/errors.ts

- **Test type:** Unit
- **Test file:** `src/paprika/errors.test.ts`
- **Phase:** 3 (Task 1)
- **Description:** Verified implicitly by the test file importing all error classes by name from `src/paprika/errors.ts`. If any expected export is missing, the test file fails to compile. This is caught by `pnpm typecheck`. The specific exports that must be importable are: `PaprikaError`, `PaprikaAuthError`, `PaprikaAPIError`.

---

## Human Verification Requirements

All acceptance criteria for this design can be fully automated. No human verification is required.

The combination of unit tests (`pnpm test`), compile-time type assertions (`pnpm typecheck` with `@ts-expect-error` and `satisfies`), and build checks (`pnpm build`) covers every AC. The key insight is that branded type safety (AC2) and domain type shape correctness (AC3) are compile-time properties verified by `pnpm typecheck`, while schema parsing behavior (AC1) and error class behavior (AC4) are runtime properties verified by vitest.

---

## Coverage Summary

| AC ID | Criterion                                                       | Test Type           | Test File                    | Verification Command          |
| ----- | --------------------------------------------------------------- | ------------------- | ---------------------------- | ----------------------------- |
| AC1.1 | RecipeEntrySchema parses valid input, returns branded RecipeUid | Unit                | `src/paprika/types.test.ts`  | `pnpm test`                   |
| AC1.2 | RecipeSchema snake_case input produces camelCase output         | Unit                | `src/paprika/types.test.ts`  | `pnpm test`                   |
| AC1.3 | Recipe.imageUrl is non-optional, non-nullable string            | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC1.4 | Recipe.categories is branded CategoryUid[]                      | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC1.5 | CategorySchema parses snake_case to camelCase                   | Unit                | `src/paprika/types.test.ts`  | `pnpm test`                   |
| AC1.6 | AuthResponseSchema parses nested token                          | Unit                | `src/paprika/types.test.ts`  | `pnpm test`                   |
| AC1.7 | RecipeSchema rejects missing required fields                    | Unit                | `src/paprika/types.test.ts`  | `pnpm test`                   |
| AC1.8 | RecipeEntrySchema rejects non-string uid                        | Unit                | `src/paprika/types.test.ts`  | `pnpm test`                   |
| AC2.1 | RecipeUid assignable to RecipeUid-typed variable                | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC2.2 | RecipeUid not assignable to CategoryUid                         | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC2.3 | Plain string not assignable to RecipeUid                        | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC3.1 | RecipeInput requires name, ingredients, directions              | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC3.2 | RecipeInput excludes uid, hash, created                         | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC3.3 | SyncResult shape: added, updated, removedUids                   | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC3.4 | DiffResult shape: added, changed, removed                       | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC4.1 | PaprikaAuthError instanceof PaprikaError instanceof Error       | Unit                | `src/paprika/errors.test.ts` | `pnpm test`                   |
| AC4.2 | PaprikaAPIError exposes readonly status and endpoint            | Unit + Compile-time | `src/paprika/errors.test.ts` | `pnpm test`, `pnpm typecheck` |
| AC4.3 | PaprikaAPIError message format: "msg (HTTP N from path)"        | Unit                | `src/paprika/errors.test.ts` | `pnpm test`                   |
| AC4.4 | All error classes accept ErrorOptions for cause chaining        | Unit                | `src/paprika/errors.test.ts` | `pnpm test`                   |
| AC4.5 | Each error class sets this.name to its class name               | Unit                | `src/paprika/errors.test.ts` | `pnpm test`                   |
| AC5.1 | pnpm build compiles with zero errors                            | Build verification  | N/A                          | `pnpm build`                  |
| AC5.2 | pnpm typecheck passes                                           | Build verification  | N/A                          | `pnpm typecheck`              |
| AC5.3 | All schemas and types are named exports from types.ts           | Compile-time        | `src/paprika/types.test.ts`  | `pnpm typecheck`              |
| AC5.4 | All error classes are named exports from errors.ts              | Compile-time        | `src/paprika/errors.test.ts` | `pnpm typecheck`              |
