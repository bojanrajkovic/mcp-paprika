# Recipe Query Store Implementation Plan

**Goal:** Build the RecipeStore class with CRUD operations, category operations, and test infrastructure.

**Architecture:** Single `RecipeStore` class in `src/cache/recipe-store.ts` backed by two `Map` instances (`Map<RecipeUid, Recipe>` and `Map<CategoryUid, Category>`). Concrete class export matching existing codebase patterns. Private readonly Maps. Uses branded UID types as Map keys for compile-time safety.

**Tech Stack:** TypeScript 5.9, vitest, zod (types only — no runtime validation in store)

**Scope:** 2 phases from original design (phase 1 of 2)

**Codebase verified:** 2026-03-07

---

## Acceptance Criteria Coverage

This phase implements and tests:

### recipe-query-store.AC1: CRUD operations

- **recipe-query-store.AC1.1 Success:** `load(recipes, categories)` populates both Maps correctly
- **recipe-query-store.AC1.2 Success:** `get(uid)` returns the recipe with matching UID
- **recipe-query-store.AC1.3 Success:** `get('nonexistent')` returns `undefined`
- **recipe-query-store.AC1.4 Success:** `getAll()` returns all recipes where `inTrash === false`
- **recipe-query-store.AC1.5 Success:** `getAll()` excludes recipes where `inTrash === true`
- **recipe-query-store.AC1.6 Success:** `set(recipe)` adds a new recipe; `get(recipe.uid)` retrieves it
- **recipe-query-store.AC1.7 Success:** `set(recipe)` overwrites an existing recipe with the same UID
- **recipe-query-store.AC1.8 Success:** `delete(uid)` removes the recipe; subsequent `get(uid)` returns `undefined`
- **recipe-query-store.AC1.9 Edge:** `delete('nonexistent')` does not throw
- **recipe-query-store.AC1.10 Success:** `size` returns 0 on a fresh store
- **recipe-query-store.AC1.11 Success:** `size` returns count of non-trashed recipes only
- **recipe-query-store.AC1.12 Success:** After `load()`, `size` reflects the number of non-trashed recipes in the input

### recipe-query-store.AC2: Category operations

- **recipe-query-store.AC2.1 Success:** `resolveCategories(['uid-1', 'uid-2'])` returns `['Name1', 'Name2']` when both exist
- **recipe-query-store.AC2.2 Success:** `resolveCategories(['uid-1', 'unknown'])` returns `['Name1']` (unknown UID dropped)
- **recipe-query-store.AC2.3 Edge:** `resolveCategories([])` returns `[]`
- **recipe-query-store.AC2.4 Success:** `setCategories(categories)` replaces all categories; `getCategory()` reflects the new set
- **recipe-query-store.AC2.5 Success:** `getAllCategories()` returns all categories in insertion order
- **recipe-query-store.AC2.6 Success:** `getCategory(uid)` returns the category with matching UID

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->

### Task 1: Test fixtures

**Verifies:** None (infrastructure — provides test data for subsequent tasks)

**Files:**

- Create: `src/cache/__fixtures__/recipes.ts`

**Implementation:**

Create factory functions that produce valid `Recipe` and `Category` objects with sensible defaults. The `Recipe` type (from `src/paprika/types.ts`) has 28 fields including branded UIDs (`RecipeUid`, `CategoryUid`). Fields like `description`, `notes`, `prepTime`, `cookTime`, `totalTime` are `string | null`.

```typescript
import type { Recipe, Category } from "../../paprika/types.js";
import type { RecipeUid, CategoryUid } from "../../paprika/types.js";

let recipeCounter = 0;
let categoryCounter = 0;

export function makeRecipe(overrides?: Partial<Recipe>): Recipe {
  recipeCounter++;
  const uid = (overrides?.uid ?? `recipe-${String(recipeCounter)}`) as RecipeUid;
  return {
    uid,
    hash: `hash-${uid}`,
    name: `Recipe ${String(recipeCounter)}`,
    categories: [] as Array<CategoryUid>,
    ingredients: "",
    directions: "",
    description: null,
    notes: null,
    prepTime: null,
    cookTime: null,
    totalTime: null,
    servings: null,
    difficulty: null,
    rating: 0,
    created: "2026-01-01T00:00:00Z",
    imageUrl: "",
    photo: null,
    photoHash: null,
    photoLarge: null,
    photoUrl: null,
    source: null,
    sourceUrl: null,
    onFavorites: false,
    inTrash: false,
    isPinned: false,
    onGroceryList: false,
    scale: null,
    nutritionalInfo: null,
    ...overrides,
  };
}

export function makeCategory(overrides?: Partial<Category>): Category {
  categoryCounter++;
  const uid = (overrides?.uid ?? `category-${String(categoryCounter)}`) as CategoryUid;
  return {
    uid,
    name: `Category ${String(categoryCounter)}`,
    orderFlag: categoryCounter,
    parentUid: null,
    ...overrides,
  };
}

/** A trashed recipe for edge-case tests. */
export const TRASHED_RECIPE = makeRecipe({
  uid: "trashed-1" as RecipeUid,
  name: "Trashed Recipe",
  inTrash: true,
});

/** A recipe with all nullable text fields populated — useful for search tests. */
export const FULLY_POPULATED_RECIPE = makeRecipe({
  uid: "full-1" as RecipeUid,
  name: "Fully Populated",
  ingredients: "flour, sugar, butter",
  directions: "Mix and bake.",
  description: "A simple recipe",
  notes: "Best served warm",
  prepTime: "15 min",
  cookTime: "30 min",
  totalTime: "45 min",
  servings: "4",
  difficulty: "Easy",
  rating: 5,
});
```

**Important details for implementor:**

- Import `Recipe`, `Category`, `RecipeUid`, `CategoryUid` from `"../../paprika/types.js"` (must use `.js` extension)
- Use `as RecipeUid` / `as CategoryUid` casts for UID fields — these are branded types created by `z.string().brand()`
- The mutable counters (`recipeCounter`, `categoryCounter`) ensure unique defaults when calling `makeRecipe()` multiple times without overrides
- `categories` field on Recipe is `Array<CategoryUid>` (array of branded strings)
- All 28 Recipe fields must be present in the factory default
- The RecipeStore public API uses branded UID types (`RecipeUid`, `CategoryUid`) — test code must cast string literals to the branded type (e.g., `"nonexistent" as RecipeUid`)

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

**Commit:** `test(cache): add recipe and category test fixtures`

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->

### Task 2: RecipeStore class with CRUD and category operations

**Verifies:** recipe-query-store.AC1.1, recipe-query-store.AC1.2, recipe-query-store.AC1.3, recipe-query-store.AC1.4, recipe-query-store.AC1.5, recipe-query-store.AC1.6, recipe-query-store.AC1.7, recipe-query-store.AC1.8, recipe-query-store.AC1.9, recipe-query-store.AC1.10, recipe-query-store.AC1.11, recipe-query-store.AC1.12, recipe-query-store.AC2.1, recipe-query-store.AC2.2, recipe-query-store.AC2.3, recipe-query-store.AC2.4, recipe-query-store.AC2.5, recipe-query-store.AC2.6

**Files:**

- Create: `src/cache/recipe-store.ts`
- Create: `src/cache/recipe-store.test.ts`
- Modify: `src/cache/CLAUDE.md` (update dependencies section)

**Implementation:**

The `RecipeStore` class with two private readonly Maps. Key behavioral details:

1. **Trash asymmetry:** `get(uid)` returns trashed recipes (the delete tool needs to fetch before deleting). All other read operations (`getAll()`, `size`) exclude trashed recipes.
2. **`load()` clears and repopulates both Maps** — it's a full replacement, not incremental.
3. **`size` is a getter** (not a method) that counts non-trashed recipes.
4. **`resolveCategories()` silently drops unknown UIDs** — returns only names for UIDs that exist in the category Map.
5. **`setCategories()` fully replaces** the category Map (clear + repopulate).
6. **`getAllCategories()` returns categories in insertion order** — Map iteration order is insertion order per the ECMAScript spec.

```typescript
import type { Recipe, Category, RecipeUid, CategoryUid } from "../paprika/types.js";

export class RecipeStore {
  private readonly recipes: Map<RecipeUid, Recipe> = new Map();
  private readonly categories: Map<CategoryUid, Category> = new Map();

  load(recipes: ReadonlyArray<Recipe>, categories: ReadonlyArray<Category>): void {
    this.recipes.clear();
    for (const recipe of recipes) {
      this.recipes.set(recipe.uid, recipe);
    }
    this.categories.clear();
    for (const category of categories) {
      this.categories.set(category.uid, category);
    }
  }

  get(uid: RecipeUid): Recipe | undefined {
    return this.recipes.get(uid);
  }

  getAll(): Array<Recipe> {
    const results: Array<Recipe> = [];
    for (const recipe of this.recipes.values()) {
      if (!recipe.inTrash) {
        results.push(recipe);
      }
    }
    return results;
  }

  set(recipe: Recipe): void {
    this.recipes.set(recipe.uid, recipe);
  }

  delete(uid: RecipeUid): void {
    this.recipes.delete(uid);
  }

  get size(): number {
    let count = 0;
    for (const recipe of this.recipes.values()) {
      if (!recipe.inTrash) {
        count++;
      }
    }
    return count;
  }

  getCategory(uid: CategoryUid): Category | undefined {
    return this.categories.get(uid);
  }

  getAllCategories(): Array<Category> {
    return [...this.categories.values()];
  }

  setCategories(categories: ReadonlyArray<Category>): void {
    this.categories.clear();
    for (const category of categories) {
      this.categories.set(category.uid, category);
    }
  }

  resolveCategories(categoryUids: ReadonlyArray<CategoryUid>): Array<string> {
    const names: Array<string> = [];
    for (const uid of categoryUids) {
      const category = this.categories.get(uid);
      if (category) {
        names.push(category.name);
      }
    }
    return names;
  }
}
```

**Testing:**

Tests must verify each AC listed above. Follow existing test patterns from `src/utils/duration.test.ts`:

- Import `{ describe, it, expect }` from `"vitest"`
- Use AC IDs in describe/it labels: `"recipe-query-store.AC1.1: load() populates both Maps correctly"`
- Import fixtures from `"./__fixtures__/recipes.js"`
- Create a fresh `RecipeStore` instance in each test (or use `beforeEach`)

Test mapping:

- recipe-query-store.AC1.1: Call `load()` with recipes and categories, verify `get()` returns them
- recipe-query-store.AC1.2: Load a recipe, call `get(uid)` — returns the recipe
- recipe-query-store.AC1.3: Call `get('nonexistent' as RecipeUid)` — returns `undefined`
- recipe-query-store.AC1.4: Load mix of trashed and non-trashed recipes, `getAll()` returns only non-trashed
- recipe-query-store.AC1.5: Same test as AC1.4 — verify trashed recipes are excluded from `getAll()`
- recipe-query-store.AC1.6: Call `set(recipe)`, then `get(recipe.uid)` — returns the recipe
- recipe-query-store.AC1.7: Call `set(recipe)` twice with same UID but different name — second value wins
- recipe-query-store.AC1.8: `set(recipe)`, then `delete(uid)`, then `get(uid)` — returns `undefined`
- recipe-query-store.AC1.9: `delete('nonexistent' as RecipeUid)` — does not throw
- recipe-query-store.AC1.10: New store, `size` is 0
- recipe-query-store.AC1.11: Load mix of trashed/non-trashed, `size` counts only non-trashed
- recipe-query-store.AC1.12: `load()` 3 recipes (1 trashed), `size` is 2
- recipe-query-store.AC2.1: Load categories, `resolveCategories(['uid-1', 'uid-2'])` returns both names
- recipe-query-store.AC2.2: `resolveCategories(['uid-1', 'unknown'])` returns only the known name
- recipe-query-store.AC2.3: `resolveCategories([])` returns empty array
- recipe-query-store.AC2.4: `setCategories(newCategories)` replaces, old categories gone
- recipe-query-store.AC2.5: `getAllCategories()` returns all in insertion order
- recipe-query-store.AC2.6: `getCategory(uid)` returns the matching category

**Update to `src/cache/CLAUDE.md`:**

Replace the Dependencies section to reflect that RecipeStore imports from `paprika/types`:

```markdown
## Dependencies

- **Uses:** `paprika/types` (Recipe, Category types)
- **Used by:** `features/`
- **Boundary:** Must not import from `tools/`, `resources/`, or `features/`
```

Note: The `utils/duration` dependency will be added in Phase 2 when `filterByTime` is implemented.

**Verification:**

Run: `pnpm typecheck`
Expected: No type errors

Run: `pnpm test`
Expected: All tests pass including new recipe-store tests

Run: `pnpm lint`
Expected: No lint errors

**Commit:** `feat(cache): add RecipeStore with CRUD and category operations`

<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->
