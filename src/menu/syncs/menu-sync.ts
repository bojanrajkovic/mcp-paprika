import type { SyncContribution } from "../../kernel/registry.js";
import type { MenuSyncResult } from "../../paprika/sync-types.js";
import type { MenuSelf } from "../module.js";
import type { Menu } from "../types.js";

import { syncReplaceAllEntity } from "../../paprika/sync.js";

// Field-wise comparator copied verbatim from `src/paprika/sync.ts:75-84` alongside
// the reconcile it serves (the production comparator moves into the owning domain).
function menusEqual(a: Menu, b: Menu): boolean {
  return (
    a.uid === b.uid &&
    a.name === b.name &&
    a.days === b.days &&
    a.orderFlag === b.orderFlag &&
    a.notes === b.notes &&
    a.deleted === b.deleted
  );
}

/**
 * Menu sync — replace-all with pending-write filtering, over the SAME proven
 * `syncReplaceAllEntity` helper the monolith used (`src/paprika/sync.ts:528-536`).
 * Carries `afterLoad: () => store.setLastSyncedAt()` — the menu-specific side-effect
 * that backs the `paprika://menu/{uid}` resource's "Last synced" header line.
 *
 * `additive` tier — the legacy engine runs menu sync inside its best-effort
 * try-block ("the menu read/write surface is strictly additive — degrading it to
 * stale data for one cycle is preferable to regressing core sync"). Menus have an
 * MCP resource surface, so this returns a `MenuSyncResult` to be emitted as
 * `sync:complete`.
 */
export function menusSync(self: MenuSelf): SyncContribution<MenuSelf, "recipe" | "meal-type"> {
  return {
    tier: "additive",
    reconcile: async (ctx): Promise<MenuSyncResult> => {
      ctx.infra.log.debug("fetching menus");
      const changes = await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listMenus(),
        cache: ctx.self.menus.cache,
        store: ctx.self.menus.store,
        equals: menusEqual,
        label: "menus",
        log: ctx.infra.log,
        afterLoad: () => ctx.self.menus.store.setLastSyncedAt(),
      });
      return { changeType: "menus", changes };
    },
    sweep: () => self.menus.store.sweepPending(),
  };
}
