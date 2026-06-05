import type { SyncContribution } from "../../../kernel/registry.js";
import type { MealState } from "../module.js";
import type { Meal } from "../types.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";

// Field-wise comparator — all nine fields; `recipeUid`/`typeUid` are both
// nullable, `scale` is string|null.
function mealsEqual(a: Meal, b: Meal): boolean {
  return (
    a.uid === b.uid &&
    a.recipeUid === b.recipeUid &&
    a.name === b.name &&
    a.date === b.date &&
    a.type === b.type &&
    a.typeUid === b.typeUid &&
    a.orderFlag === b.orderFlag &&
    a.isIngredient === b.isIngredient &&
    a.scale === b.scale
  );
}

/**
 * Meal sync — replace-all with orphan cleanup and pending-write filtering via
 * `syncReplaceAllEntity`.
 *
 * `additive` tier — the meal-history read surface is strictly additive; degrading
 * meals to stale data for one sync cycle is preferable to regressing core sync.
 * The kernel driver runs each additive reconcile in its own try/catch, so a meal
 * fetch failure does not abort the rest of the additive phase. Meals have no MCP
 * resource surface, so this emits NO `sync:complete` (returns `void`).
 */
export function mealSync(state: MealState): SyncContribution<MealState, never> {
  return {
    tier: "additive",
    reconcile: async (ctx) => {
      await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listMeals(),
        cache: ctx.state.cache,
        store: ctx.state.store,
        equals: mealsEqual,
        label: "meals",
        log: ctx.infra.log,
      });
    },
    sweep: () => state.store.sweepPending(),
  };
}
