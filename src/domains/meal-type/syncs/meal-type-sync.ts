import type { SyncContribution } from "../../../kernel/registry.js";
import type { MealTypeSelf } from "../module.js";

/**
 * Meal-type sync — replace-all via DIRECT `store.load` (NOT `syncReplaceAllEntity`):
 * meal-types are a plain `EntityStore` reference catalog (no tombstones, no
 * pending-upsert observation), so they load directly. This is NOT a bare load —
 * it filters `deleted: true` tombstones and removes orphaned cache entries.
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
      // Filter `deleted: true` like aisles do: GET responses normally omit
      // deleted items, but POSTs use `deleted: true` for soft-deletes (see
      // mealtypes.har.json) so the field is on the schema, and any tombstone
      // that does reach the wire must not be loaded as an active mealtype.
      const mealTypesRaw = await ctx.infra.client.listMealTypes();
      const mealTypes = mealTypesRaw.filter((mt) => !mt.deleted);

      const cachedMealTypes = await cache.getAll();
      const cachedMealTypeUids = new Set(cachedMealTypes.map((mt) => mt.uid));
      const incomingMealTypeUids = new Set(mealTypes.map((mt) => mt.uid));
      const orphanMealTypeUids = [...cachedMealTypeUids].filter((uid) => !incomingMealTypeUids.has(uid));
      await Promise.all(orphanMealTypeUids.map((uid) => cache.remove(uid)));

      store.load(mealTypes);
      await Promise.all(mealTypes.map((mt) => cache.put(mt)));

      if (orphanMealTypeUids.length > 0) {
        ctx.infra.log.debug({ count: orphanMealTypeUids.length }, "removed orphan meal types");
      }
    },
    sweep: () => self.store.sweepPending(),
  };
}
