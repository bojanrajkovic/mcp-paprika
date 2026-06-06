import type { SyncContribution } from "../../../kernel/registry.js";
import type { GroceryItemSyncResult } from "../../../paprika/sync-types.js";
import type { GroceryState } from "../module.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";
import { groceryItemsEqual } from "../grocery-item/types.js";

/**
 * Grocery-item sync — replace-all with pending-write filtering via
 * `syncReplaceAllEntity`. No `afterLoad` (unlike grocery lists): only the parent
 * grocery-list store carries `lastSyncedAt`.
 *
 * `core` tier — runs after grocery lists (children reference parent), inside the
 * outer try that aborts the cycle on failure. Grocery items are inlined in the
 * `paprika://grocery-list/{uid}` resource, so this returns a `GroceryItemSyncResult`
 * to be emitted as `sync:complete` (a child-item change invalidates the parent
 * resource).
 */
export function groceryItemsSync(state: GroceryState): SyncContribution<GroceryState, "aisle" | "pantry"> {
  return {
    tier: "core",
    reconcile: (ctx) => {
      ctx.infra.log.debug("fetching grocery items");
      return syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listGroceryItems(),
        cache: ctx.state.items.cache,
        store: ctx.state.items.store,
        equals: groceryItemsEqual,
        label: "grocery items",
        log: ctx.infra.log,
      }).map((changes): GroceryItemSyncResult => ({ changeType: "grocery-items", changes }));
    },
    sweep: () => state.items.store.sweepPending(),
  };
}
