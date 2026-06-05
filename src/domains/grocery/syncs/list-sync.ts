import type { SyncContribution } from "../../../kernel/registry.js";
import type { GroceryListSyncResult } from "../../../paprika/sync-types.js";
import type { GroceryState } from "../module.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";
import { groceryListsEqual } from "../grocery-list/types.js";

/**
 * Grocery-list sync — replace-all with pending-write filtering via
 * `syncReplaceAllEntity`. Carries `afterLoad: () => store.setLastSyncedAt()` — the
 * grocery-list-specific
 * side-effect that backs the `paprika://grocery-list/{uid}` resource's "Last synced"
 * header line.
 *
 * `core` tier — inside the outer try that aborts the cycle on failure; not one of
 * the additive (meals/menus/photos) best-effort blocks. Grocery lists have an MCP
 * resource surface, so this returns a `GroceryListSyncResult` to be emitted as
 * `sync:complete`.
 */
export function groceryListsSync(state: GroceryState): SyncContribution<GroceryState, "aisle" | "pantry"> {
  return {
    tier: "core",
    reconcile: async (ctx): Promise<GroceryListSyncResult> => {
      ctx.infra.log.debug("fetching grocery lists");
      const changes = await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listGroceryLists(),
        cache: ctx.state.lists.cache,
        store: ctx.state.lists.store,
        equals: groceryListsEqual,
        label: "grocery lists",
        log: ctx.infra.log,
        afterLoad: () => ctx.state.lists.store.setLastSyncedAt(),
      });
      return { changeType: "grocery-lists", changes };
    },
    sweep: () => state.lists.store.sweepPending(),
  };
}
