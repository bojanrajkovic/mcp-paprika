import type { SyncContribution } from "../../../kernel/registry.js";
import type { MealTypeSelf } from "../module.js";

import { pruneOrphanCache } from "../../../paprika/sync.js";

/**
 * Meal-type sync — replace-all via DIRECT `store.load` (NOT `syncReplaceAllEntity`):
 * meal-types are a plain `EntityStore` reference catalog (no pending-upsert
 * observation), so they load directly. This is NOT a bare load —
 * it removes orphaned cache entries.
 *
 * `reference` tier — meal-types are a lookup catalog meal and menu resolve names
 * against at read time, alongside aisle and category. Runs best-effort ahead of core,
 * so a transient meal-type fetch failure degrades to the last-good catalog (consumers
 * gate on `hasSynced`, which latches) rather than aborting the primary data sync.
 * `core` was rejected: meal-type's consumers (meal, menu) are themselves best-effort,
 * so promotion would buy no ordering and only widen the abort blast-radius (ADR-0010).
 */
export function mealTypeSync(self: MealTypeSelf): SyncContribution<MealTypeSelf, never> {
  return {
    tier: "reference",
    reconcile: async (ctx) => {
      const { store, cache } = ctx.self;
      const mealTypes = await ctx.infra.client.listMealTypes();

      // Intentionally NOT filtered by `deleted`: meal types hard-delete, so `listMealTypes()`
      // never returns a `deleted:true` row (only recipes soft-delete, via `inTrash`) — a
      // deleted-row filter would guard a state that cannot occur. See docs/architecture.md (Caching and sync).
      const cachedMealTypeUids = new Set((await cache.getAll()).map((mt) => mt.uid));
      const incomingMealTypeUids = new Set(mealTypes.map((mt) => mt.uid));
      await pruneOrphanCache(cache, cachedMealTypeUids, incomingMealTypeUids, ctx.infra.log, "meal types");

      store.load(mealTypes);
      await Promise.all(mealTypes.map((mt) => cache.put(mt)));
    },
    sweep: () => self.store.sweepPending(),
  };
}
