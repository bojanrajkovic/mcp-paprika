import type { SyncContribution } from "../../../kernel/registry.js";
import type { MenuItemSyncResult } from "../../../paprika/sync-types.js";
import type { MenuItem } from "../menu-item/types.js";
import type { MenuSelf } from "../module.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";

// `orderFlag` is menu-wide (not per-day) — a single comparable field that covers
// ordering across all days of the menu.
function menuItemsEqual(a: MenuItem, b: MenuItem): boolean {
  return (
    a.uid === b.uid &&
    a.menuUid === b.menuUid &&
    a.recipeUid === b.recipeUid &&
    a.name === b.name &&
    a.day === b.day &&
    a.typeUid === b.typeUid &&
    a.orderFlag === b.orderFlag
  );
}

/**
 * Menu-item sync — replace-all with pending-write filtering via `syncReplaceAllEntity`.
 * No `afterLoad` (unlike menus): only the parent menu store carries `lastSyncedAt`.
 *
 * `additive` tier — runs after menus (children reference parent). Menuitems are
 * inlined in the `paprika://menu/{uid}` resource, so this returns a
 * `MenuItemSyncResult` to be emitted as `sync:complete` (a child-item change
 * invalidates the parent resource).
 */
export function menuItemsSync(self: MenuSelf): SyncContribution<MenuSelf, "recipe" | "meal-type"> {
  return {
    tier: "additive",
    reconcile: async (ctx): Promise<MenuItemSyncResult> => {
      ctx.infra.log.debug("fetching menu items");
      const changes = await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listMenuItems(),
        cache: ctx.self.items.cache,
        store: ctx.self.items.store,
        equals: menuItemsEqual,
        label: "menu items",
        log: ctx.infra.log,
      });
      return { changeType: "menu-items", changes };
    },
    sweep: () => self.items.store.sweepPending(),
  };
}
