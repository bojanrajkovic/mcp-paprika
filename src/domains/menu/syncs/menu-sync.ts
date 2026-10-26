import type { SyncContribution } from "../../../kernel/sync.js";
import type { MenuSyncResult } from "../../../paprika/sync-types.js";
import type { MenuState } from "../module.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";
import { menusEqual } from "../types.js";

/**
 * Menu sync — replace-all with pending-write filtering via `syncReplaceAllEntity`.
 *
 * `additive` tier — the menu read/write surface must not abort core sync; degrading
 * to stale data for one cycle is preferable to regressing core sync. Returns a
 * `MenuSyncResult` so its changes are counted in the cycle's change-count metrics.
 */
export function menusSync(state: MenuState): SyncContribution<MenuState, "recipe" | "meal-type"> {
  return {
    tier: "additive",
    reconcile: (ctx) => {
      ctx.infra.log.debug("fetching menus");
      return syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listMenus(),
        cache: ctx.state.menus.cache,
        store: ctx.state.menus.store,
        equals: menusEqual,
        label: "menus",
        log: ctx.infra.log,
      }).map((changes): MenuSyncResult => ({ changeType: "menus", changes }));
    },
    sweep: () => state.menus.store.sweepPending(),
  };
}
