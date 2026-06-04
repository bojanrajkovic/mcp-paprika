import type { GroceryList } from "../../grocery-list/types.js";
import type { SyncContribution } from "../../kernel/registry.js";
import type { GroceryListSyncResult } from "../../paprika/sync-types.js";
import type { GrocerySelf } from "../module.js";

import { syncReplaceAllEntity } from "../../paprika/sync.js";

// Field-wise comparator copied verbatim from `src/paprika/sync.ts:49-58` alongside
// the reconcile it serves (the production comparator moves into the owning domain).
function groceryListsEqual(a: GroceryList, b: GroceryList): boolean {
  return (
    a.uid === b.uid &&
    a.name === b.name &&
    a.orderFlag === b.orderFlag &&
    a.isDefault === b.isDefault &&
    a.remindersList === b.remindersList &&
    a.deleted === b.deleted
  );
}

/**
 * Grocery-list sync — replace-all with pending-write filtering, over the SAME proven
 * `syncReplaceAllEntity` helper the monolith used (`src/paprika/sync.ts:415-423`).
 * Carries `afterLoad: () => store.setLastSyncedAt()` — the grocery-list-specific
 * side-effect that backs the `paprika://grocery-list/{uid}` resource's "Last synced"
 * header line.
 *
 * `core` tier — grocery is step 4 of the legacy in-order core sequence
 * (recipes → categories → aisles → pantry → grocery lists → grocery items →
 * ingredients), inside the outer try that aborts the cycle on failure; it is NOT one
 * of the additive (meals/menus/photos) best-effort blocks. Grocery lists have an MCP
 * resource surface, so this returns a `GroceryListSyncResult` to be emitted as
 * `sync:complete`.
 */
export function groceryListsSync(self: GrocerySelf): SyncContribution<GrocerySelf, "aisle" | "pantry"> {
  return {
    tier: "core",
    reconcile: async (ctx): Promise<GroceryListSyncResult> => {
      ctx.infra.log.debug("fetching grocery lists");
      const changes = await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listGroceryLists(),
        cache: ctx.self.lists.cache,
        store: ctx.self.lists.store,
        equals: groceryListsEqual,
        label: "grocery lists",
        log: ctx.infra.log,
        afterLoad: () => ctx.self.lists.store.setLastSyncedAt(),
      });
      return { changeType: "grocery-lists", changes };
    },
    sweep: () => self.lists.store.sweepPending(),
  };
}
