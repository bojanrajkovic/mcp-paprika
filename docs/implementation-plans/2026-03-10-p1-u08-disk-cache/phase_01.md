# DiskCache Implementation Plan — Phase 1: Schema Extension

**Goal:** Introduce `recipeCamelShape`, `RecipeStoredSchema`, and `CategoryStoredSchema` in `src/paprika/types.ts` so that camelCase JSON read back from disk can be validated without re-running the snake_case → camelCase transform.

**Architecture:** Extract the 28 camelCase field definitions from `RecipeSchema`'s transform output into a shared `recipeCamelShape` constant. Derive `RecipeStoredSchema = z.object(recipeCamelShape)` for disk validation and rederive `Recipe = z.infer<typeof RecipeStoredSchema>`. Annotate `RecipeSchema`'s transform return type as `: Recipe` so the compiler enforces that both schemas produce identical types. Apply the same pattern to `CategorySchema`.

**Tech Stack:** TypeScript 5.9, Zod

**Scope:** Phase 1 of 5 from the original design

**Codebase verified:** 2026-03-10

---

## Acceptance Criteria Coverage

Phase 1 is a structural refactoring with no new behaviour. It is infrastructure for Phases 2–4 and verifies no acceptance criteria directly. The `Recipe` and `Category` types are structurally identical to before — the TypeScript compiler and existing tests provide the verification gate.

**Verifies: None**

---

<!-- START_SUBCOMPONENT_A (tasks 1-1) -->
<!-- START_TASK_1 -->

### Task 1: Refactor `src/paprika/types.ts` — add `RecipeStoredSchema`, `CategoryStoredSchema`

**Files:**

- Modify: `src/paprika/types.ts`

**Implementation:**

Replace the entire `src/paprika/types.ts` file with the following. The only structural changes are:

1. A new file-local `recipeCamelShape` constant (unexported) that holds the 28 camelCase field definitions.
2. A new exported `RecipeStoredSchema = z.object(recipeCamelShape)` for validating camelCase JSON from disk.
3. `Recipe` is now derived from `RecipeStoredSchema` using `z.infer` (was `z.output<typeof RecipeSchema>`). The types are structurally identical — the change is only in which schema drives the type.
4. `RecipeSchema`'s transform callback now has an explicit `: Recipe` return type annotation. This ties the transform output to `RecipeStoredSchema`'s shape at compile time — if the two ever diverge, `tsc` will catch it.
5. A new file-local `categoryCamelShape` constant (unexported) and exported `CategoryStoredSchema` — the same pattern for categories.
6. `Category` is rederived from `CategoryStoredSchema`.

```typescript
import { z } from "zod";
import type { SetRequired } from "type-fest";

// Branded UID schemas using z.string().brand()
export const RecipeUidSchema = z.string().brand("RecipeUid");
export const CategoryUidSchema = z.string().brand("CategoryUid");

// Derived UID types via z.infer<>
export type RecipeUid = z.infer<typeof RecipeUidSchema>;
export type CategoryUid = z.infer<typeof CategoryUidSchema>;

// Entry schemas for sync list endpoints
export const RecipeEntrySchema = z.object({
  uid: RecipeUidSchema,
  hash: z.string(),
});

export const CategoryEntrySchema = z.object({
  uid: CategoryUidSchema,
  hash: z.string(),
});

// Derived entry types via z.infer<>
export type RecipeEntry = z.infer<typeof RecipeEntrySchema>;
export type CategoryEntry = z.infer<typeof CategoryEntrySchema>;

// Single source of truth for all camelCase recipe field definitions.
// Used by RecipeStoredSchema (disk validation) and RecipeSchema's transform
// return annotation so both schemas produce identical Recipe types.
const recipeCamelShape = {
  uid: RecipeUidSchema,
  hash: z.string(),
  name: z.string(),
  categories: z.array(CategoryUidSchema),
  ingredients: z.string(),
  directions: z.string(),
  description: z.string().nullable(),
  notes: z.string().nullable(),
  prepTime: z.string().nullable(),
  cookTime: z.string().nullable(),
  totalTime: z.string().nullable(),
  servings: z.string().nullable(),
  difficulty: z.string().nullable(),
  rating: z.number().int(),
  created: z.string(),
  imageUrl: z.string(),
  photo: z.string().nullable(),
  photoHash: z.string().nullable(),
  photoLarge: z.string().nullable(),
  photoUrl: z.string().nullable(),
  source: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  onFavorites: z.boolean(),
  inTrash: z.boolean(),
  isPinned: z.boolean(),
  onGroceryList: z.boolean(),
  scale: z.string().nullable(),
  nutritionalInfo: z.string().nullable(),
};

// StoredSchema — validates camelCase JSON read back from disk. No transform.
export const RecipeStoredSchema = z.object(recipeCamelShape);

// Recipe type derived from RecipeStoredSchema (structurally identical to the
// previous z.output<typeof RecipeSchema>).
export type Recipe = z.infer<typeof RecipeStoredSchema>;

// RecipeSchema — accepts snake_case wire format, transforms to camelCase Recipe.
// The `: Recipe` annotation on the transform return ensures the compiler enforces
// that RecipeSchema's output is always structurally identical to RecipeStoredSchema.
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
    }): Recipe => ({
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

// Single source of truth for all camelCase category field definitions.
const categoryCamelShape = {
  uid: CategoryUidSchema,
  name: z.string(),
  orderFlag: z.number().int(),
  parentUid: z.string().nullable(),
};

// StoredSchema — validates camelCase JSON read back from disk. No transform.
export const CategoryStoredSchema = z.object(categoryCamelShape);

// Category type derived from CategoryStoredSchema.
export type Category = z.infer<typeof CategoryStoredSchema>;

// CategorySchema — accepts snake_case wire format, transforms to camelCase Category.
export const CategorySchema = z
  .object({
    uid: CategoryUidSchema,
    name: z.string(),
    order_flag: z.number().int(),
    parent_uid: z.string().nullable(),
  })
  .transform(
    ({ order_flag, parent_uid, ...rest }): Category => ({
      ...rest,
      orderFlag: order_flag,
      parentUid: parent_uid,
    }),
  );

// AuthResponseSchema - nested object, no transform needed
export const AuthResponseSchema = z.object({
  result: z.object({
    token: z.string(),
  }),
});

export type AuthResponse = z.output<typeof AuthResponseSchema>;

// Domain types for application use
export type RecipeInput = SetRequired<
  Partial<Omit<Recipe, "uid" | "hash" | "created">>,
  "name" | "ingredients" | "directions"
>;

export type SyncResult = {
  readonly added: ReadonlyArray<Recipe>;
  readonly updated: ReadonlyArray<Recipe>;
  readonly removedUids: ReadonlyArray<string>;
};

export type DiffResult = {
  readonly added: ReadonlyArray<string>;
  readonly changed: ReadonlyArray<string>;
  readonly removed: ReadonlyArray<string>;
};
```

**Step 1: Replace `src/paprika/types.ts` with the code above**

Copy the complete file content above into `src/paprika/types.ts`.

**Step 2: Verify type-check passes**

```bash
pnpm typecheck
```

Expected: Zero errors. If the `: Recipe` annotation on `RecipeSchema`'s transform produces an error, it means `recipeCamelShape` does not match the previous transform output — fix the field definitions to match.

**Step 3: Verify existing tests still pass**

```bash
pnpm test -- src/paprika/types.test.ts
```

Expected: All tests pass. No new tests are needed — `RecipeStoredSchema` and `CategoryStoredSchema` will be tested in Phase 3 via round-trip tests.

**Step 4: Commit**

```bash
git add src/paprika/types.ts
git commit -m "refactor(paprika): extract recipeCamelShape and add RecipeStoredSchema, CategoryStoredSchema"
```

<!-- END_TASK_1 -->
<!-- END_SUBCOMPONENT_A -->
