import type { SyncContribution } from "../../kernel/registry.js";
import type { MenuItem } from "../../menu-item/types.js";
import type { MenuItemSyncResult } from "../../paprika/sync-types.js";
import type { MenuSelf } from "../module.js";

import { syncReplaceAllEntity } from "../../paprika/sync.js";

// Field-wise comparator copied verbatim from `src/paprika/sync.ts:86-97` alongside
// the reconcile it serves (the production comparator moves into the owning domain).
// `orderFlag` is menu-wide (not per-day) — preserved by comparing it as one field,
// exactly as the legacy engine does.
function menuItemsEqual(a: MenuItem, b: MenuItem): boolean {
  return (
    a.uid === b.uid &&
    a.menuUid === b.menuUid &&
    a.recipeUid === b.recipeUid &&
    a.name === b.name &&
    a.day === b.day &&
    a.typeUid === b.typeUid &&
    a.orderFlag === b.orderFlag &&
    a.deleted === b.deleted
  );
}

/**
 * Menu-item sync — replace-all with pending-write filtering, over the SAME proven
 * `syncReplaceAllEntity` helper the monolith used (`src/paprika/sync.ts:540-547`).
 * No `afterLoad` (unlike menus): only the parent menu store carries `lastSyncedAt`.
 *
 * `additive` tier — runs after menus (children reference parent), inside the same
 * best-effort surface. Menuitems are inlined in the `paprika://menu/{uid}` resource,
 * so this returns a `MenuItemSyncResult` to be emitted as `sync:complete` (a
 * child-item change invalidates the parent resource).
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
