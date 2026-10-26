import type { SyncContribution } from "../../../kernel/registry.js";
import type { GroceryItemSyncResult } from "../../../paprika/sync-types.js";
import type { GroceryState } from "../module.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";
import { groceryItemsEqual } from "../grocery-item/types.js";

/**
 * Grocery-item sync — replace-all with pending-write filtering via
 * `syncReplaceAllEntity`.
 *
 * `core` tier — runs after grocery lists (children reference parent), inside the
 * outer try that aborts the cycle on failure. Returns a `GroceryItemSyncResult` so
 * its changes are counted in the cycle's change-count metrics.
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
