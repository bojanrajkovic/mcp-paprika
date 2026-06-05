import type { SyncContribution } from "../../kernel/registry.js";
import type { MealTypeState } from "./module.js";

import { pruneOrphanCache } from "../../paprika/sync.js";

/**
 * Meal-type sync — replace-all WITH pending-write filtering (mirrors aisle-sync, NOT
 * the `syncReplaceAllEntity` helper): it filters pending-upsert rows, merges cached
 * pending-upserts back, removes orphans from the cache, then observation-clears
 * confirmed pending-upserts (a pending-upsert UID present in the canonical list means
 * the server confirmed the auto-create — clear now rather than at TTL). `ensureMealType`
 * is the write path that marks pending, so the `sweep` is live.
 *
 * `reference` tier — meal-types are a lookup catalog meal and menu resolve names
 * against at read time, alongside aisle and category. Runs best-effort ahead of core,
 * so a transient meal-type fetch failure degrades to the last-good catalog (consumers
 * gate on `hasSynced`, which latches) rather than aborting the primary data sync.
 * `core` was rejected: meal-type's consumers (meal, menu) are themselves best-effort,
 * so promotion would buy no ordering and only widen the abort blast-radius (ADR-0010).
 */
export function mealTypeSync(state: MealTypeState): SyncContribution<MealTypeState, never> {
  return {
    tier: "reference",
    reconcile: async (ctx) => {
      const { store, cache } = ctx.state;
      const mealTypes = await ctx.infra.client.listMealTypes();
      const cachedMealTypes = await cache.getAll();

      // Intentionally NOT filtered by `deleted`: meal types hard-delete, so `listMealTypes()`
      // never returns a `deleted:true` row (only recipes soft-delete, via `inTrash`) — a
      // deleted-row filter would guard a state that cannot occur. See docs/architecture.md (Caching and sync).
      // Filter just-created (pending-upsert) types out of the canonical list and merge the
      // cached copies back, so a snapshot taken before the create propagated can't drop them.
      const incomingMealTypesFiltered = mealTypes.filter((mt) => !store.isPendingUpsert(mt.uid));
      const pendingUpsertedMealTypes = cachedMealTypes.filter((mt) => store.isPendingUpsert(mt.uid));
      const effectiveMealTypes = [...incomingMealTypesFiltered, ...pendingUpsertedMealTypes];

      const cachedMealTypeUids = new Set(cachedMealTypes.map((mt) => mt.uid));
      const effectiveMealTypeUids = new Set(effectiveMealTypes.map((mt) => mt.uid));
      await pruneOrphanCache(cache, cachedMealTypeUids, effectiveMealTypeUids, ctx.infra.log, "meal types");

      store.load(effectiveMealTypes);
      await Promise.all(effectiveMealTypes.map((mt) => cache.put(mt)));

      // Observation-clear: a pending-upsert UID present in the canonical list means the
      // create propagated, so clear now rather than waiting for the TTL sweep.
      for (const mealType of mealTypes) {
        if (store.isPendingUpsert(mealType.uid)) {
          store.clearPending(mealType.uid);
        }
      }
    },
    sweep: () => state.store.sweepPending(),
  };
}
