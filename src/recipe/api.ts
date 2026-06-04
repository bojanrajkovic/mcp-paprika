import type { CategoryUid, RecipeUid } from "../ids.js";
import type { Recipe } from "./types.js";

/**
 * Recipe's public contract — the surface meal, menu, meal-planner, discover, and
 * photo-gen consume via `ctx.deps.recipe`. Recipe owns three entities (recipes,
 * categories, photos) after the collapse, so the category resolvers live here too
 * (categories are no longer a separate domain). The stores and caches stay private;
 * siblings reach only these methods.
 *
 * Designed from the verified live cross-domain call sites, not the spike's
 * illustrative `count()` (which has no live consumer):
 *   - `get` — the recipe-name/existence read every meal/menu/coordinator write does;
 *   - `resolveCategoryRefs` — meal's `search_meal_history` UID/name → CategoryUid;
 *   - `resolveCategoryNames` — meal label, discover display, photo-gen prompt.
 */
export interface RecipeApi {
  /** UID lookup; `undefined` for an unknown or trashed-and-pruned UID. */
  get(uid: RecipeUid): Recipe | undefined;
  /**
   * Resolve category references (each a `CategoryUid` or a case-insensitive
   * display name) to `{ uids, unknown }`. `unknown` carries refs that matched
   * neither, for the caller to warn on. Called by meal's `search_meal_history`.
   */
  resolveCategoryRefs(refs: ReadonlyArray<string>): {
    readonly uids: ReadonlyArray<CategoryUid>;
    readonly unknown: ReadonlyArray<string>;
  };
  /**
   * Resolve recipe category foreign keys to display names, skipping any UID with
   * no matching category. Called by meal (`search_meal_history` label), discover
   * (display), and photo-gen (prompt).
   */
  resolveCategoryNames(uids: ReadonlyArray<CategoryUid>): ReadonlyArray<string>;
  /**
   * The `RecipeUid`s of every (non-trashed) recipe filed under a category. Recipe
   * owns categories, so this membership query lives here; meal's `search_meal_history`
   * "class" filter calls it. Mirrors the live
   * `store.getAll().filter(r => r.categories.includes(uid)).map(r => r.uid)` set.
   */
  recipesInCategory(categoryUid: CategoryUid): ReadonlyArray<RecipeUid>;
  /** Whether the recipe store has completed its first sync — the meal-planner cold-start gate. */
  hasSynced(): boolean;
}
