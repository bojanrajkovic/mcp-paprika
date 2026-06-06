import type { Result } from "neverthrow";

import type { HasSynced } from "../../kernel/registry.js";
import type { CategoryUid, RecipeUid } from "./ids.js";
import type { Photo } from "./photo/types.js";
import type { Recipe } from "./types.js";

/**
 * Recipe's public contract — the surface meal, menu, meal-planner, grocery, discover, and
 * photo-gen consume via `ctx.deps.recipe`. Recipe owns three entities (recipes,
 * categories, photos) — there is no separate category or photo domain — so the
 * category resolvers live here too.
 *
 * Scoped to exactly the live cross-domain call sites (nothing speculative):
 *   - `get` — the recipe-name/existence read every meal/menu/coordinator write does;
 *   - `resolveCategoryRefs` — meal's `search_meal_history` UID/name → CategoryUid;
 *   - `resolveCategoryNames` — meal label, discover display, photo-gen prompt.
 *
 * The inherited `hasSynced` is the meal-planner cold-start gate — the recipe store
 * must be warm before the coordinator resolves recipe names.
 */
export interface RecipeApi extends HasSynced {
  /** UID lookup; `undefined` for an unknown or trashed-and-pruned UID. */
  get(uid: RecipeUid): Recipe | undefined;
  /**
   * Tiered case-insensitive name lookup (exact → starts-with → contains), returning
   * the matches from at most one tier; trashed recipes excluded. Backs grocery's
   * `add_recipe_to_grocery_list` uid-or-title resolve (mirrors `MenuApi.findByName`).
   */
  findByName(title: string): ReadonlyArray<Recipe>;
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
  /**
   * Every non-trashed recipe. The bulk enumeration discover's cold-start index
   * rebuild walks; recipe owns recipes, so it exposes this read rather than handing
   * out the store. Mirrors `store.getAll()` (excludes trashed).
   */
  getAll(): ReadonlyArray<Recipe>;
  /** The non-trashed recipe count — discover's `index.size < recipes.size * 0.9` rebuild guard. */
  size(): number;
  /**
   * Attach an AI-generated image (raw full-resolution bytes) to a recipe — the
   * recipe-domain write `generate_recipe_photo` (attach:true) calls, since recipe
   * owns the photo entity and photo-gen reaches it only through this contract. Looks
   * up the recipe, gates on the photo catalog being synced, normalizes the bytes
   * (sharp; generated-image edge cap), then runs the verified upload through the same
   * `attachPhotoToRecipe` chokepoint `upload_recipe_photo` uses. Returns the saved
   * `Photo`, or `{ message }` to surface to the caller.
   */
  attachGeneratedPhoto(recipeUid: RecipeUid, full: Buffer): Promise<Result<Photo, { readonly message: string }>>;
}
