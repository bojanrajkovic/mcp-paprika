import type { GroceryItem } from "../../grocery-item/types.js";
import type { SyncContribution } from "../../kernel/registry.js";
import type { GroceryItemSyncResult } from "../../paprika/sync-types.js";
import type { GrocerySelf } from "../module.js";

import { syncReplaceAllEntity } from "../../paprika/sync.js";

// Field-wise comparator copied verbatim from `src/paprika/sync.ts:111-127` alongside
// the reconcile it serves (the production comparator moves into the owning domain).
function groceryItemsEqual(a: GroceryItem, b: GroceryItem): boolean {
  return (
    a.uid === b.uid &&
    a.name === b.name &&
    a.ingredient === b.ingredient &&
    a.aisle === b.aisle &&
    a.aisleUid === b.aisleUid &&
    a.listUid === b.listUid &&
    a.purchased === b.purchased &&
    a.deleted === b.deleted &&
    a.orderFlag === b.orderFlag &&
    a.quantity === b.quantity &&
    a.instruction === b.instruction &&
    a.recipe === b.recipe &&
    a.separate === b.separate
  );
}

/**
 * Grocery-item sync — replace-all with pending-write filtering, over the SAME proven
 * `syncReplaceAllEntity` helper the monolith used (`src/paprika/sync.ts:427-434`).
 * No `afterLoad` (unlike grocery lists): only the parent grocery-list store carries
 * `lastSyncedAt`.
 *
 * `core` tier — runs after grocery lists (children reference parent), inside the same
 * core surface whose failure aborts the cycle. Grocery items are inlined in the
 * `paprika://grocery-list/{uid}` resource, so this returns a `GroceryItemSyncResult`
 * to be emitted as `sync:complete` (a child-item change invalidates the parent
 * resource).
 */
export function groceryItemsSync(self: GrocerySelf): SyncContribution<GrocerySelf, "aisle" | "pantry"> {
  return {
    tier: "core",
    reconcile: async (ctx): Promise<GroceryItemSyncResult> => {
      ctx.infra.log.debug("fetching grocery items");
      const changes = await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listGroceryItems(),
        cache: ctx.self.items.cache,
        store: ctx.self.items.store,
        equals: groceryItemsEqual,
        label: "grocery items",
        log: ctx.infra.log,
      });
      return { changeType: "grocery-items", changes };
    },
    sweep: () => self.items.store.sweepPending(),
  };
}
