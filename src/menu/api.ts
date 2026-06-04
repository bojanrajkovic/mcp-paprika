import type { MenuUid } from "../ids.js";
import type { MenuItem } from "../menu-item/types.js";
import type { Menu } from "./types.js";

/**
 * Menu's public contract — the read surface the meal-planner coordinator consumes
 * via `ctx.deps.menu` to materialize a saved menu as planner meals (`schedule_menu`).
 * Menu owns two entities (menus, menu-items); the stores and caches stay private,
 * and siblings reach only these methods. Returns the domain VALUE objects
 * (`Menu`/`MenuItem`), never the stores — analogous to `RecipeApi.get` returning a
 * `Recipe`; the isolation proof forbids `ctx.deps.menu.store`.
 *
 * Designed from the verified live cross-domain call sites in
 * `src/tools/meal-add-menu.ts` (the coordinator tool), not the spike's illustrative
 * placeholders:
 *   - `get` / `findByName` — resolve a menu by uid or name (the coordinator's `resolveLookup`);
 *   - `itemsOf` — the menu's items to materialize (wraps `menuItemStore.getByMenuUid`).
 */
export interface MenuApi {
  /** UID lookup; `undefined` for an unknown or tombstoned menu UID. */
  get(uid: MenuUid): Menu | undefined;
  /**
   * Tiered case-insensitive name lookup (exact → starts-with → contains), returning
   * the matches from at most one tier. Backs the coordinator's name-or-uid resolve.
   */
  findByName(query: string): ReadonlyArray<Menu>;
  /** All non-tombstoned items of a menu, in store order (wraps `getByMenuUid`). */
  itemsOf(menuUid: MenuUid): ReadonlyArray<MenuItem>;
  /** Whether BOTH owned stores (menus + menu-items) have completed their first sync — the meal-planner readiness gate. */
  hasSynced(): boolean;
}
