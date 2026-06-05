import type { SyncContribution } from "../../../kernel/registry.js";
import type { MenuSyncResult } from "../../../paprika/sync-types.js";
import type { MenuState } from "../module.js";
import type { Menu } from "../types.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";

function menusEqual(a: Menu, b: Menu): boolean {
  return (
    a.uid === b.uid && a.name === b.name && a.days === b.days && a.orderFlag === b.orderFlag && a.notes === b.notes
  );
}

/**
 * Menu sync — replace-all with pending-write filtering via `syncReplaceAllEntity`.
 * Carries `afterLoad: () => store.setLastSyncedAt()` — the menu-specific side-effect
 * that backs the `paprika://menu/{uid}` resource's "Last synced" header line.
 *
 * `additive` tier — the menu read/write surface must not abort core sync; degrading
 * to stale data for one cycle is preferable to regressing core sync. Menus have an
 * MCP resource surface, so this returns a `MenuSyncResult` to be emitted as
 * `sync:complete`.
 */
export function menusSync(state: MenuState): SyncContribution<MenuState, "recipe" | "meal-type"> {
  return {
    tier: "additive",
    reconcile: async (ctx): Promise<MenuSyncResult> => {
      ctx.infra.log.debug("fetching menus");
      const changes = await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listMenus(),
        cache: ctx.state.menus.cache,
        store: ctx.state.menus.store,
        equals: menusEqual,
        label: "menus",
        log: ctx.infra.log,
        afterLoad: () => ctx.state.menus.store.setLastSyncedAt(),
      });
      return { changeType: "menus", changes };
    },
    sweep: () => state.menus.store.sweepPending(),
  };
}
