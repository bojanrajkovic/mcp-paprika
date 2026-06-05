import type { SyncContribution } from "../../../kernel/registry.js";
import type { PantrySyncResult } from "../../../paprika/sync-types.js";
import type { PantryState } from "../module.js";
import type { PantryItem } from "../types.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";

/**
 * Field-wise equality for pantry items — all 11 fields, so a no-op canonical
 * snapshot doesn't churn the cache or clear a pending-upsert prematurely.
 */
function pantryItemsEqual(a: PantryItem, b: PantryItem): boolean {
  return (
    a.uid === b.uid &&
    a.ingredient === b.ingredient &&
    a.quantity === b.quantity &&
    a.aisle === b.aisle &&
    a.aisleUid === b.aisleUid &&
    a.expirationDate === b.expirationDate &&
    a.hasExpiration === b.hasExpiration &&
    a.inStock === b.inStock &&
    a.purchaseDate === b.purchaseDate &&
    a.notes === b.notes
  );
}

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
