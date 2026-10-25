import type { SyncContribution } from "../../../kernel/registry.js";
import type { GroceryListSyncResult } from "../../../paprika/sync-types.js";
import type { GroceryState } from "../module.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";
import { groceryListsEqual } from "../grocery-list/types.js";

/**
 * Grocery-list sync — replace-all with pending-write filtering via
 * `syncReplaceAllEntity`.
 *
 * `core` tier — inside the outer try that aborts the cycle on failure; not one of
 * the additive (meals/menus/photos) best-effort blocks. Returns a
 * `GroceryListSyncResult` so its changes are counted in the cycle's change-count metrics.
 */
export function groceryListsSync(state: GroceryState): SyncContribution<GroceryState, "aisle" | "pantry"> {
  return {
    tier: "core",
    reconcile: (ctx) => {
      ctx.infra.log.debug("fetching grocery lists");
      return syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listGroceryLists(),
        cache: ctx.state.lists.cache,
        store: ctx.state.lists.store,
        equals: groceryListsEqual,
        label: "grocery lists",
        log: ctx.infra.log,
      }).map((changes): GroceryListSyncResult => ({ changeType: "grocery-lists", changes }));
    },
    sweep: () => state.lists.store.sweepPending(),
  };
}
