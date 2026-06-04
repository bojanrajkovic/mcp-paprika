import type { Aisle } from "../../src/domains/aisle/types.js";
import type { GroceryIngredient } from "../../src/domains/grocery/grocery-ingredient/types.js";
import type { GroceryItem } from "../../src/domains/grocery/grocery-item/types.js";
import type { GroceryList } from "../../src/domains/grocery/grocery-list/types.js";
import type { MealType } from "../../src/domains/meal-type/types.js";
import type { Meal } from "../../src/domains/meal/types.js";
import type { MenuItem } from "../../src/domains/menu/menu-item/types.js";
import type { Menu } from "../../src/domains/menu/types.js";
import type { PantryItem } from "../../src/domains/pantry/types.js";
import type { Category } from "../../src/domains/recipe/category/types.js";
import type { Photo } from "../../src/domains/recipe/photo/types.js";
import type { Recipe } from "../../src/domains/recipe/types.js";

/**
 * Declarative seed payload routed to a set of in-memory stores. Each key maps to
 * one hydratable store; supplying it routes the array through that store's
 * `load(items)`, which is the same entry point the sync layer uses. Consumed by
 * the kernel test harness's `seed()` (see `test/support/kernel-harness.ts`), which
 * dispatches each key to the matching module's private store.
 *
 * **Omitted vs. empty is meaningful.** A key left out leaves its store untouched
 * — `hasSynced` stays `false`, so cold-start guards (`coldStartGuard`,
 * `*StartGuard`) still fire. Passing an explicit `[]` calls `load([])`, which
 * marks the store **synced-but-empty** (an empty snapshot is a valid synced
 * state — see `EntityStore.baseLoad`). Use `[]` to get past a guard with no data.
 */
export interface SeedData {
  readonly recipes?: ReadonlyArray<Recipe>;
  readonly categories?: ReadonlyArray<Category>;
  readonly pantry?: ReadonlyArray<PantryItem>;
  readonly aisles?: ReadonlyArray<Aisle>;
  readonly groceryLists?: ReadonlyArray<GroceryList>;
  readonly groceryItems?: ReadonlyArray<GroceryItem>;
  readonly groceryIngredients?: ReadonlyArray<GroceryIngredient>;
  readonly meals?: ReadonlyArray<Meal>;
  readonly mealTypes?: ReadonlyArray<MealType>;
  readonly menus?: ReadonlyArray<Menu>;
  readonly menuItems?: ReadonlyArray<MenuItem>;
  readonly photos?: ReadonlyArray<Photo>;
}
