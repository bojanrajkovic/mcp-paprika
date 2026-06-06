import type { HasSynced } from "../../kernel/registry.js";
import type { MealTypeUid } from "../meal-type/ids.js";
import type { MenuUid } from "./ids.js";
import type { MenuItem } from "./menu-item/types.js";
import type { Menu } from "./types.js";

/**
 * Menu's public contract — the read surface the meal-planner coordinator consumes
 * via `ctx.deps.menu`. Returns the domain VALUE objects (`Menu`/`MenuItem`), never
 * the stores — analogous to `RecipeApi.get` returning a `Recipe`.
 *
 * Scoped to the verified live cross-domain call sites in the meal-planner coordinator,
 * nothing speculative. For `schedule_menu` (materialize a saved menu as planner meals):
 *   - `get` / `findByName` — resolve a menu by uid or name (the coordinator's `resolveLookup`);
 *   - `itemsOf` — the menu's items to materialize (wraps `menuItemStore.getByMenuUid`).
 * For `delete_meal_type` (report how many menu items will lose their type label):
 *   - `itemCountByTypeUid` — the informational reference count (warn-and-proceed).
 *
 * The inherited `hasSynced` is the meal-planner readiness gate; menu's implementation
 * (in `module.ts`) AND-s BOTH owned stores (menus + menu-items) being synced.
 */
export interface MenuApi extends HasSynced {
  /** UID lookup; `undefined` for an unknown menu UID. */
  get(uid: MenuUid): Menu | undefined;
  /**
   * Tiered case-insensitive name lookup (exact → starts-with → contains), returning
   * the matches from at most one tier. Backs the coordinator's name-or-uid resolve.
   */
  findByName(query: string): ReadonlyArray<Menu>;
  /** All items of a menu, in store order (wraps `getByMenuUid`). */
  itemsOf(menuUid: MenuUid): ReadonlyArray<MenuItem>;
  /** How many menu items reference a meal type — `delete_meal_type`'s informational count. */
  itemCountByTypeUid(uid: MealTypeUid): number;
}
