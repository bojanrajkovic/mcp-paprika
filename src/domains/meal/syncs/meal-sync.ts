import type { SyncContribution } from "../../../kernel/registry.js";
import type { MealSelf } from "../module.js";
import type { Meal } from "../types.js";

import { syncReplaceAllEntity } from "../../../paprika/sync.js";

// Field-wise comparator copied verbatim from `src/paprika/sync.ts:60-73` alongside
// the reconcile it serves (the production comparator moves into the owning domain).
// All ten fields — `recipeUid`/`typeUid` are both nullable, `scale` is string|null.
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
    a.scale === b.scale &&
    a.deleted === b.deleted
  );
}

/**
 * Meal sync — replace-all with orphan cleanup and pending-write filtering, over the
 * SAME proven `syncReplaceAllEntity` helper the monolith used
 * (`src/paprika/sync.ts:502-511`). The kernel's driver only sequences it.
 *
 * `additive` tier — the meal-history read surface is strictly additive (the live
 * engine runs this inside a best-effort try/catch, comment "8. Meal sync"); the
 * kernel driver runs each additive reconcile in its own try, so degrading meals to
 * stale data for one cycle is preferable to regressing core sync. Meals have no MCP
 * resource surface, so this emits NO `sync:complete` (returns `void`).
 */
export function mealSync(self: MealSelf): SyncContribution<MealSelf, never> {
  return {
    tier: "additive",
    reconcile: async (ctx) => {
      await syncReplaceAllEntity({
        fetch: () => ctx.infra.client.listMeals(),
        cache: ctx.self.cache,
        store: ctx.self.store,
        equals: mealsEqual,
        label: "meals",
        log: ctx.infra.log,
      });
    },
    sweep: () => self.store.sweepPending(),
  };
}
