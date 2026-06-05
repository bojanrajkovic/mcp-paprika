import type { SyncContribution } from "../../kernel/registry.js";
import type { PantrySyncResult } from "../../paprika/sync-types.js";
import type { PantryState } from "./module.js";

import { syncReplaceAllEntity } from "../../paprika/sync.js";
import { pantryItemsEqual } from "./types.js";

/**
 * Pantry sync — replace-all with orphan cleanup via the shared
 * `syncReplaceAllEntity` helper (`PantryStore extends EntityStore`).
 * Pending-write filtering and observation-clearing are handled inside the helper.
 * The kernel's driver only sequences it.
 *
 * `core` tier — pantry is step 3 of the in-order core sequence
 * (recipes → categories → aisles → pantry → grocery), inside the outer try that
 * aborts the cycle on failure; it is NOT one of the additive (meals/menus/photos)
 * best-effort blocks. Returns a `PantrySyncResult` to be emitted as
 * `sync:complete` (the subscriber is a no-op for pantry — it has no resource
 * surface — but returning the changes faithfully preserves the emission contract).
 */
export function pantrySync(state: PantryState): SyncContribution<PantryState, "aisle"> {
  return {
    tier: "core",
    reconcile: async (ctx): Promise<PantrySyncResult> => {
      const { store, cache } = ctx.state;
      const changes = await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listPantry(),
        cache,
        store,
        equals: pantryItemsEqual,
        label: "pantry items",
        log: ctx.infra.log,
      });
      return { changeType: "pantry", changes };
    },
    sweep: () => state.store.sweepPending(),
  };
}
