import type { SyncContribution } from "../../../kernel/registry.js";
import type { MenuItemSyncResult } from "../../../paprika/sync-types.js";
import type { MenuState } from "../module.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";
import { menuItemsEqual } from "../menu-item/types.js";

/**
 * Menu-item sync — replace-all with pending-write filtering via `syncReplaceAllEntity`.
 * No `afterLoad` (unlike menus): only the parent menu store carries `lastSyncedAt`.
 *
 * `additive` tier — runs after menus (children reference parent). Menuitems are
 * inlined in the `paprika://menu/{uid}` resource, so this returns a
 * `MenuItemSyncResult` to be emitted as `sync:complete` (a child-item change
 * invalidates the parent resource).
 */
export function menuItemsSync(state: MenuState): SyncContribution<MenuState, "recipe" | "meal-type"> {
  return {
    tier: "additive",
    reconcile: (ctx) => {
      ctx.infra.log.debug("fetching menu items");
      return syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listMenuItems(),
        cache: ctx.state.items.cache,
        store: ctx.state.items.store,
        equals: menuItemsEqual,
        label: "menu items",
        log: ctx.infra.log,
      }).map((changes): MenuItemSyncResult => ({ changeType: "menu-items", changes }));
    },
    sweep: () => state.items.store.sweepPending(),
  };
}
