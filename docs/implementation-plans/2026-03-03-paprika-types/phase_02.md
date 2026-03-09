# Paprika Type Definitions — Phase 2: Full Object Schemas, Domain Types, and RecipeInput

**Goal:** Define full Recipe/Category schemas with snake_case-to-camelCase transforms, AuthResponseSchema, and all domain types.

**Architecture:** Zod schemas accept snake_case API wire format and transform to camelCase for application code. `z.input<>` gives the wire shape, `z.output<>` / `z.infer<>` gives the app shape. Branded UIDs from Phase 1 are preserved through transforms by passing values through (TypeScript infers the branded type from the input schema). Domain types use plain `type` aliases — no Zod overhead for types that don't cross system boundaries.

**Tech Stack:** TypeScript 5.9, Zod 3.25.x, type-fest `SetRequired`

**Scope:** 3 phases from original design (phase 2 of 3)

**Codebase verified:** 2026-03-03

---

## Acceptance Criteria Coverage

This phase implements and tests:

### paprika-types.AC1: Zod schemas validate API responses

- **paprika-types.AC1.2 Success:** RecipeSchema parses a full snake_case API response and outputs camelCase fields
- **paprika-types.AC1.3 Success:** Recipe.imageUrl is `string` (non-optional, non-nullable)
- **paprika-types.AC1.4 Success:** Recipe.categories is `CategoryUid[]` (branded, not plain string)
- **paprika-types.AC1.5 Success:** CategorySchema parses `{uid, name, order_flag, parent_uid}` with camelCase output
- **paprika-types.AC1.6 Success:** AuthResponseSchema parses `{result: {token: "..."}}`
- **paprika-types.AC1.7 Failure:** RecipeSchema rejects response missing required fields

### paprika-types.AC3: Domain types are correctly shaped

- **paprika-types.AC3.1 Success:** RecipeInput requires name, ingredients, directions; all other fields optional
- **paprika-types.AC3.2 Success:** RecipeInput excludes uid, hash, created
- **paprika-types.AC3.3 Success:** SyncResult has added: Recipe[], updated: Recipe[], removedUids: string[]
- **paprika-types.AC3.4 Success:** DiffResult has added: string[], changed: string[], removed: string[]

### paprika-types.AC5: Build and exports

- **paprika-types.AC5.1 Success:** pnpm build compiles with zero errors
- **paprika-types.AC5.2 Success:** pnpm typecheck passes
- **paprika-types.AC5.3 Success:** All schemas and types are named exports from src/paprika/types.ts

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->

### Task 1: RecipeSchema with snake_case-to-camelCase transform

**Verifies:** paprika-types.AC1.2, paprika-types.AC1.3, paprika-types.AC1.4

**Files:**

- Modify: `src/paprika/types.ts` (append after entry schemas from Phase 1)

**Context files to read first:**

- `/home/brajkovic/Projects/mcp-paprika/src/paprika/types.ts` — existing UID and entry schemas from Phase 1

**Implementation:**

Add `RecipeSchema` to `src/paprika/types.ts`. The schema accepts the Paprika API's snake_case wire format and transforms to camelCase output.

The Paprika API returns 28 fields for a recipe. The schema must:

1. Define all input fields in snake_case with appropriate Zod validators
2. Use `RecipeUidSchema` for `uid` and `z.array(CategoryUidSchema)` for `categories` to preserve branding
3. Transform snake_case fields to camelCase using destructure + spread

**Field definitions** (from Paprika Cloud Sync API):

| API field (snake_case) | Output field (camelCase) | Zod type                                        |
| ---------------------- | ------------------------ | ----------------------------------------------- |
| `uid`                  | `uid`                    | `RecipeUidSchema` (branded)                     |
| `hash`                 | `hash`                   | `z.string()`                                    |
| `name`                 | `name`                   | `z.string()`                                    |
| `categories`           | `categories`             | `z.array(CategoryUidSchema)` (branded elements) |
| `ingredients`          | `ingredients`            | `z.string()`                                    |
| `directions`           | `directions`             | `z.string()`                                    |
| `description`          | `description`            | `z.string().nullable()`                         |
| `notes`                | `notes`                  | `z.string().nullable()`                         |
| `prep_time`            | `prepTime`               | `z.string().nullable()`                         |
| `cook_time`            | `cookTime`               | `z.string().nullable()`                         |
| `total_time`           | `totalTime`              | `z.string().nullable()`                         |
| `servings`             | `servings`               | `z.string().nullable()`                         |
| `difficulty`           | `difficulty`             | `z.string().nullable()`                         |
| `rating`               | `rating`                 | `z.number().int()`                              |
| `created`              | `created`                | `z.string()`                                    |
| `image_url`            | `imageUrl`               | `z.string()` (AC1.3: non-nullable)              |
| `photo`                | `photo`                  | `z.string().nullable()`                         |
| `photo_hash`           | `photoHash`              | `z.string().nullable()`                         |
| `photo_large`          | `photoLarge`             | `z.string().nullable()`                         |
| `photo_url`            | `photoUrl`               | `z.string().nullable()`                         |
| `source`               | `source`                 | `z.string().nullable()`                         |
| `source_url`           | `sourceUrl`              | `z.string().nullable()`                         |
| `on_favorites`         | `onFavorites`            | `z.boolean()`                                   |
| `in_trash`             | `inTrash`                | `z.boolean()`                                   |
| `is_pinned`            | `isPinned`               | `z.boolean()`                                   |
| `on_grocery_list`      | `onGroceryList`          | `z.boolean()`                                   |
| `scale`                | `scale`                  | `z.string().nullable()`                         |
| `nutritional_info`     | `nutritionalInfo`        | `z.string().nullable()`                         |

**Transform pattern** — destructure snake_case fields that need renaming, spread the rest:

```typescript
export const RecipeSchema = z
  .object({
    uid: RecipeUidSchema,
    hash: z.string(),
    name: z.string(),
    categories: z.array(CategoryUidSchema),
    ingredients: z.string(),
    directions: z.string(),
    description: z.string().nullable(),
    notes: z.string().nullable(),
    prep_time: z.string().nullable(),
    cook_time: z.string().nullable(),
    total_time: z.string().nullable(),
    servings: z.string().nullable(),
    difficulty: z.string().nullable(),
    rating: z.number().int(),
    created: z.string(),
    image_url: z.string(),
    photo: z.string().nullable(),
    photo_hash: z.string().nullable(),
    photo_large: z.string().nullable(),
    photo_url: z.string().nullable(),
    source: z.string().nullable(),
    source_url: z.string().nullable(),
    on_favorites: z.boolean(),
    in_trash: z.boolean(),
    is_pinned: z.boolean(),
    on_grocery_list: z.boolean(),
    scale: z.string().nullable(),
    nutritional_info: z.string().nullable(),
  })
  .transform(
    ({
      image_url,
      prep_time,
      cook_time,
      total_time,
      photo_hash,
      photo_large,
      photo_url,
      source_url,
      on_favorites,
      in_trash,
      is_pinned,
      on_grocery_list,
      nutritional_info,
      ...rest
    }) => ({
      ...rest,
      imageUrl: image_url,
      prepTime: prep_time,
      cookTime: cook_time,
      totalTime: total_time,
      photoHash: photo_hash,
      photoLarge: photo_large,
      photoUrl: photo_url,
      sourceUrl: source_url,
      onFavorites: on_favorites,
      inTrash: in_trash,
      isPinned: is_pinned,
      onGroceryList: on_grocery_list,
      nutritionalInfo: nutritional_info,
    }),
  );

export type Recipe = z.output<typeof RecipeSchema>;
```

**Why `z.output<>` instead of `z.infer<>`:** Both are equivalent for the output type, but `z.output<>` is explicit about being the post-transform shape. Use `z.output<>` consistently for schemas with transforms.

**Brand preservation:** `uid` and `categories` are in `...rest` (not destructured), so TypeScript infers their branded types from the input schema. `rest.uid` is `RecipeUid`, `rest.categories` is `Array<CategoryUid>`.

**Verification:**

Run: `pnpm typecheck`
Expected: Passes with zero errors

Run: `pnpm lint`
Expected: No warnings or errors

Run: `pnpm format:check`
Expected: All files formatted correctly (run `pnpm format` to fix if needed)

**Commit:** `feat(paprika): add RecipeSchema with camelCase transform`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: CategorySchema and AuthResponseSchema

**Verifies:** paprika-types.AC1.5, paprika-types.AC1.6

**Files:**

- Modify: `src/paprika/types.ts` (append after RecipeSchema)

**Implementation:**

Add `CategorySchema` and `AuthResponseSchema` to `src/paprika/types.ts`.

**CategorySchema** — 4 fields, 2 need renaming:

```typescript
export const CategorySchema = z
  .object({
    uid: CategoryUidSchema,
    name: z.string(),
    order_flag: z.number().int(),
    parent_uid: z.string().nullable(),
  })
  .transform(({ order_flag, parent_uid, ...rest }) => ({
    ...rest,
    orderFlag: order_flag,
    parentUid: parent_uid,
  }));

export type Category = z.output<typeof CategorySchema>;
```

**AuthResponseSchema** — nested object, no transform needed:

```typescript
export const AuthResponseSchema = z.object({
  result: z.object({
    token: z.string(),
  }),
});

export type AuthResponse = z.output<typeof AuthResponseSchema>;
```

**Verification:**

Run: `pnpm typecheck`
Expected: Passes with zero errors

Run: `pnpm lint`
Expected: No warnings or errors

Run: `pnpm format:check`
Expected: All files formatted correctly (run `pnpm format` to fix if needed)

**Commit:** `feat(paprika): add CategorySchema and AuthResponseSchema`

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->

### Task 3: Tests for full object schemas

**Verifies:** paprika-types.AC1.2, paprika-types.AC1.3, paprika-types.AC1.4, paprika-types.AC1.5, paprika-types.AC1.6, paprika-types.AC1.7

**Files:**

- Modify: `src/paprika/types.test.ts` (extend test file from Phase 1)

**Context files to read first:**

- `/home/brajkovic/Projects/mcp-paprika/src/paprika/types.test.ts` — existing tests from Phase 1

**Testing:**

Tests must verify each AC listed above:

- **paprika-types.AC1.2:** Construct a complete snake_case recipe object (all 28 fields), parse through `RecipeSchema`. Assert the output has camelCase field names: `imageUrl`, `prepTime`, `cookTime`, `totalTime`, `photoHash`, `photoLarge`, `photoUrl`, `sourceUrl`, `onFavorites`, `inTrash`, `isPinned`, `onGroceryList`, `nutritionalInfo`. Assert the values are preserved correctly. Assert fields that don't change names (`uid`, `hash`, `name`, etc.) are still present.

- **paprika-types.AC1.3:** After parsing a valid recipe, assert that `result.imageUrl` is a `string`. Use `// @ts-expect-error` to verify that assigning `null` to a variable typed `Recipe["imageUrl"]` is a compile error.

- **paprika-types.AC1.4:** After parsing a valid recipe with `categories: ["cat-1", "cat-2"]`, assert the parsed `categories` is an array. Use `// @ts-expect-error` to verify that assigning a plain `string` to a variable typed `Recipe["categories"][number]` produces a compile error (because it's branded `CategoryUid`).

- **paprika-types.AC1.5:** Parse `{uid: "cat-1", name: "Desserts", order_flag: 0, parent_uid: null}` through `CategorySchema`. Assert the output has `orderFlag` (not `order_flag`) and `parentUid` (not `parent_uid`). Assert values are preserved.

- **paprika-types.AC1.6:** Parse `{result: {token: "test-jwt-token"}}` through `AuthResponseSchema`. Assert `result.result.token` equals `"test-jwt-token"`.

- **paprika-types.AC1.7:** Attempt to parse an object missing required fields (e.g., missing `name` and `ingredients`) through `RecipeSchema`. Assert it throws a `ZodError`.

Follow project testing patterns: vitest, colocated in `src/paprika/types.test.ts`.

**Verification:**

Run: `pnpm typecheck`
Expected: Passes (verifies `@ts-expect-error` annotations)

Run: `pnpm test`
Expected: All tests pass

Run: `pnpm lint`
Expected: No warnings or errors

Run: `pnpm format:check`
Expected: All files formatted correctly (run `pnpm format` to fix if needed)

**Commit:** `test(paprika): add full object schema validation tests`

<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->

### Task 4: Domain types — RecipeInput, SyncResult, DiffResult

**Verifies:** paprika-types.AC3.1, paprika-types.AC3.2, paprika-types.AC3.3, paprika-types.AC3.4, paprika-types.AC5.3

**Files:**

- Modify: `src/paprika/types.ts` (append after schema definitions, add type-fest import at top)

**Implementation:**

Add the type-fest import at the top of the file and domain type definitions at the bottom.

**RecipeInput** — for recipe creation/updates. All `Recipe` fields except `uid`, `hash`, `created` are available. `name`, `ingredients`, `directions` are required; everything else is optional:

```typescript
import type { SetRequired } from "type-fest";

export type RecipeInput = SetRequired<
  Partial<Omit<Recipe, "uid" | "hash" | "created">>,
  "name" | "ingredients" | "directions"
>;
```

**SyncResult** — result of a sync operation:

```typescript
export type SyncResult = {
  readonly added: ReadonlyArray<Recipe>;
  readonly updated: ReadonlyArray<Recipe>;
  readonly removedUids: ReadonlyArray<string>;
};
```

**DiffResult** — result of comparing local vs remote state:

```typescript
export type DiffResult = {
  readonly added: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
};
```

**Verification:**

Run: `pnpm build`
Expected: Compiles with zero errors

Run: `pnpm typecheck`
Expected: Passes with zero errors

Run: `pnpm lint`
Expected: No warnings or errors

Run: `pnpm format:check`
Expected: All files formatted correctly (run `pnpm format` to fix if needed)

**Commit:** `feat(paprika): add RecipeInput, SyncResult, and DiffResult domain types`

<!-- END_TASK_4 -->

<!-- START_TASK_5 -->

### Task 5: Compile-time type assertions for domain types

**Verifies:** paprika-types.AC3.1, paprika-types.AC3.2, paprika-types.AC3.3, paprika-types.AC3.4

**Files:**

- Modify: `src/paprika/types.test.ts` (append compile-time assertions)

**Testing:**

Domain types are pure TypeScript types with no runtime behavior — they are verified by the compiler, not by runtime tests. Add compile-time assertions using `@ts-expect-error` and `satisfies`:

- **paprika-types.AC3.1:** Assert that `{name: "x", ingredients: "y", directions: "z"}` satisfies `RecipeInput` (minimum required fields). Assert via `@ts-expect-error` that an object missing `name` does NOT satisfy `RecipeInput`.

- **paprika-types.AC3.2:** Verify that `RecipeInput` does not include `uid`, `hash`, or `created` keys. Use a conditional type assertion pattern rather than `@ts-expect-error` with object assignment (TypeScript's structural typing allows excess properties in assignment). The recommended approach is to assert key exclusion at the type level:

  ```typescript
  // Verify excluded keys are not in RecipeInput
  type AssertNoUid = "uid" extends keyof RecipeInput ? never : true;
  type AssertNoHash = "hash" extends keyof RecipeInput ? never : true;
  type AssertNoCreated = "created" extends keyof RecipeInput ? never : true;

  // These resolve to `true` if the key is excluded, `never` if present
  const _checkNoUid: AssertNoUid = true;
  const _checkNoHash: AssertNoHash = true;
  const _checkNoCreated: AssertNoCreated = true;
  ```

  If any excluded key is actually present in `RecipeInput`, the conditional type resolves to `never` and the assignment to `true` fails at compile time.

- **paprika-types.AC3.3:** Assert that `{added: [], updated: [], removedUids: []}` satisfies `SyncResult`.

- **paprika-types.AC3.4:** Assert that `{added: [], changed: [], removed: []}` satisfies `DiffResult`.

These are compile-time only — `pnpm typecheck` verifies them. Include them in the test file so they're checked alongside runtime tests.

**Verification:**

Run: `pnpm typecheck`
Expected: Passes (all `@ts-expect-error` annotations are valid)

Run: `pnpm test`
Expected: All tests pass

Run: `pnpm lint`
Expected: No warnings or errors

Run: `pnpm format:check`
Expected: All files formatted correctly (run `pnpm format` to fix if needed)

**Commit:** `test(paprika): add compile-time domain type assertions`

<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->
