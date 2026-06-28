import type { MealTypeApi } from "../../meal-type/api.js";
import type { MealRow, MealTypeRef } from "../meal-schema.js";
import type { MealState } from "../module.js";
import type { Meal } from "../types.js";

import { sortCatalog } from "../../../shared/catalog.js";

// The structured-output schemas live in the clean leaf `../meal-schema.js` (zod + id leaves only)
// so the meal-week-planner widget can re-export their inferred types without dragging this
// catalog-importing module into the browser typecheck. Re-exported here for the meal tools that
// already import their schema surface from this file.
export { mealListOutputSchema, mealRowSchema, mealTypeRefSchema, mealWeekOutputSchema } from "../meal-schema.js";
export type { MealRow, MealTypeRef, MealWeekStructured } from "../meal-schema.js";

/**
 * Meal-domain tool helpers — the per-date `order_flag` assigner and the structured
 * meal-row builders. Readiness gating lives in `guards.ts`; meal-type spec resolution
 * goes through `deps["meal-type"].resolveSpec(spec)` (the meal-type module owns that
 * resolver and publishes it on its api).
 */

/**
 * Builds a stateful, per-DATE `order_flag` assigner for a batch of new meals.
 * `order_flag` sequences PER CALENDAR DATE — all meal types on a given day share
 * one sequence, NOT a separate sequence per (date, type). `getMaxOrderFlagOn(date)`
 * seeds each date from the persisted store state; the returned closure then hands
 * out an increasing counter per date so multiple meals in ONE batch that share a
 * date get sequential flags.
 */
export function makeMealOrderFlagAssigner(state: MealState): (date: string) => number {
  const next = new Map<string, number>();
  return (date) => {
    const flag = next.get(date) ?? (state.store.getMaxOrderFlagOn(date) ?? -1) + 1;
    next.set(date, flag + 1);
    return flag;
  };
}

/**
 * Build the two meal-type lookup maps from the catalog in one pass: `byUid` (the
 * primary key) and `byOriginalType` (the legacy integer fallback for meals predating
 * the catalog, populated only for built-in types). Drives the structured-row type-name
 * resolver.
 */
function mealTypeLookups(mealType: MealTypeApi): {
  byUid: Map<string, string>;
  byOriginalType: Map<number, string>;
} {
  const byUid = new Map<string, string>();
  const byOriginalType = new Map<number, string>();
  for (const mt of mealType.getAll()) {
    byUid.set(mt.uid, mt.name);
    // Only built-in types have a non-null originalType; custom types are looked up
    // by typeUid alone.
    if (mt.originalType !== null) byOriginalType.set(mt.originalType, mt.name);
  }
  return { byUid, byOriginalType };
}

/**
 * Build the ordered meal-type registry for {@link mealWeekOutputSchema} via the shared
 * {@link sortCatalog} (orderFlag, ties broken by name) — the same order `list_meal_types`
 * uses, so the widget's day slots stack Breakfast → Lunch → Dinner → … consistently with
 * the rest of the surface, without the widget re-sorting.
 */
export function mealTypeRegistry(mealType: MealTypeApi): Array<MealTypeRef> {
  return sortCatalog(mealType.getAll()).map((mt) => ({ uid: mt.uid, name: mt.name }));
}

/**
 * Build a meal → type-name resolver from the catalog, returning the resolved name or
 * `null` when the type is dangling or unknown. The structured-channel counterpart to
 * the text renderers' display fallbacks (`—` / `Type N`): the structured row carries
 * raw truth (a `typeUid` whose label is gone resolves to `null`), the text carries a
 * human placeholder. Built once per call and reused across the rows.
 */
export function resolveMealTypeName(mealType: MealTypeApi): (meal: Readonly<Meal>) => string | null {
  const { byUid, byOriginalType } = mealTypeLookups(mealType);
  return (meal) =>
    meal.typeUid !== null ? (byUid.get(meal.typeUid) ?? null) : (byOriginalType.get(meal.type) ?? null);
}

/** Map a stored `Meal` plus its already-resolved type name into a {@link MealRow}. */
export function mealToRow(meal: Readonly<Meal>, typeName: string | null): MealRow {
  return {
    uid: meal.uid,
    date: meal.date.slice(0, 10),
    name: meal.name,
    recipeUid: meal.recipeUid,
    typeUid: meal.typeUid,
    typeName,
    scale: meal.scale,
  };
}
