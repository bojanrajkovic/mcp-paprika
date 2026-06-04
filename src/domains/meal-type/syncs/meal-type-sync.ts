import type { SyncContribution } from "../../../kernel/registry.js";
import type { MealTypeSelf } from "../module.js";

import { pruneOrphanCache } from "../../../paprika/sync.js";

/**
 * Meal-type sync — replace-all via DIRECT `store.load` (NOT `syncReplaceAllEntity`):
 * meal-types are a plain `EntityStore` reference catalog (no pending-upsert
 * observation), so they load directly. This is NOT a bare load —
 * it removes orphaned cache entries.
 *
 * `additive` tier — a meal-type fetch failure should degrade best-effort rather
 * than abort the sync cycle. Topo order sequences meal-type before meal/menu
 * within the additive phase, so consumers see an up-to-date catalog in time. The
 * kernel driver runs EACH additive reconcile in its own try/catch, so a meal-type
 * failure does not skip the subsequent meal/menu reconciles (deliberate
 * failure-isolation). Promoting to `core` for reference-catalog consistency with
 * aisle/category was considered but deferred as a post-migration improvement.
 */
export function mealTypeSync(self: MealTypeSelf): SyncContribution<MealTypeSelf, never> {
  return {
    tier: "additive",
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
