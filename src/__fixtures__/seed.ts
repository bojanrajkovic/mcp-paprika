import type { AppContext } from "../server/app-context.js";
import type {
  Aisle,
  Category,
  GroceryIngredient,
  GroceryItem,
  GroceryList,
  Meal,
  MealType,
  Menu,
  MenuItem,
  PantryItem,
  Photo,
  Recipe,
} from "../paprika/types.js";

/**
 * Declarative seed payload for a test {@link AppContext}. Each key maps to one
 * hydratable in-memory store; supplying it routes the array through that store's
 * `load(items)`, which is the same entry point the sync layer uses.
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

/**
 * Hydrates the stores on a test {@link AppContext} from a single declarative
 * payload, routing each collection to the correct store. This is the ONE place
 * a store's hydration signature is referenced from test setup, so a future
 * entity or signature change touches this helper instead of every call site —
 * the same insulation {@link makeAppContext} gives AppContext construction.
 *
 * Returns the same `ctx` for chaining:
 *
 * ```ts
 * const ctx = seed(makeCtx(new RecipeStore(), server), {
 *   recipes: [makeRecipe()],
 *   categories: [makeCategory()],
 * });
 * ```
 *
 * @see SeedData for the omitted-vs-empty-array semantics.
 */
export function seed(ctx: AppContext, data: SeedData): AppContext {
  if (data.recipes) ctx.store.load(data.recipes);
  if (data.categories) ctx.categoryStore.load(data.categories);
  if (data.pantry) ctx.pantryStore.load(data.pantry);
  if (data.aisles) ctx.aisleStore.load(data.aisles);
  if (data.groceryLists) ctx.groceryListStore.load(data.groceryLists);
  if (data.groceryItems) ctx.groceryItemStore.load(data.groceryItems);
  if (data.groceryIngredients) ctx.groceryIngredientStore.load(data.groceryIngredients);
  if (data.meals) ctx.mealStore.load(data.meals);
  if (data.mealTypes) ctx.mealTypeStore.load(data.mealTypes);
  if (data.menus) ctx.menuStore.load(data.menus);
  if (data.menuItems) ctx.menuItemStore.load(data.menuItems);
  if (data.photos) ctx.photoStore.load(data.photos);
  return ctx;
}
