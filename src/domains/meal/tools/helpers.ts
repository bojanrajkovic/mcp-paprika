import { DateTime } from "luxon";

import type { MealTypeApi } from "../../meal-type/api.js";
import type { RecipeApi } from "../../recipe/api.js";
import type { MealState } from "../module.js";
import type { Meal } from "../types.js";

import { mealToMarkdown } from "../meal-helpers.js";

/**
 * Meal-domain tool helpers — the per-date `order_flag` assigner and the meal-card
 * renderers. Readiness gating lives in `guards.ts`; meal-type spec resolution goes
 * through `deps["meal-type"].resolveSpec(spec)` (the meal-type module owns that
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
 * Resolve a meal's display names from the deps, then render its markdown card.
 * Wraps the pure `mealToMarkdown` with the lookups every meal-write response path
 * repeats: typeName from the meal-type catalog, and recipeName from the recipe
 * store. Meals with `typeUid: null` (legacy, predating the catalog) fall back to
 * the integer-labelled `Type N`; a non-null typeUid that misses the catalog is a
 * DANGLING reference (its type was deleted — ADR-0017) and renders no type line
 * at all. `recipeUid: null` renders freeform.
 */
export function renderMealCard(meal: Readonly<Meal>, recipe: RecipeApi, mealType: MealTypeApi): string {
  const typeNameByUid = new Map<string, string>();
  for (const mt of mealType.getAll()) typeNameByUid.set(mt.uid, mt.name);
  const typeName = meal.typeUid !== null ? (typeNameByUid.get(meal.typeUid) ?? null) : `Type ${meal.type.toString()}`;
  const recipeName = meal.recipeUid !== null ? (recipe.get(meal.recipeUid)?.name ?? null) : null;
  return mealToMarkdown(meal, typeName, recipeName);
}

function formatMealLine(
  meal: Readonly<Meal>,
  typeNames: Map<string, string>,
  typeByOriginalType: Map<number, string>,
): { typeName: string; entry: string } {
  // typeUid is the primary lookup, but older meals (predating Paprika's
  // mealtypes catalog) carry typeUid: null and rely on the `type` integer
  // (which corresponds to MealType.originalType in the catalog). A non-null
  // typeUid that misses the catalog is a DANGLING reference (its type was
  // deleted — ADR-0017) and groups under "—" rather than a misleading Type N.
  const typeName =
    meal.typeUid !== null
      ? (typeNames.get(meal.typeUid) ?? "—")
      : (typeByOriginalType.get(meal.type) ?? `Type ${meal.type.toString()}`);
  const isFreeform = meal.recipeUid === null || meal.recipeUid === "";
  const entry = isFreeform ? `${meal.name} *(freeform)*` : meal.name;
  return { typeName, entry };
}

/**
 * Render meals as a date-grouped calendar section: one `### EEE dd` heading per
 * calendar day — in the order the meals are supplied, so the CALLER controls
 * chronology — then one `- **Type** · entry, entry` bullet per meal type on that
 * day, with freeform meals annotated. Returns just the grouped body.
 */
export function renderMealsGroupedByDate(meals: ReadonlyArray<Readonly<Meal>>, mealType: MealTypeApi): string {
  const typeNames = new Map<string, string>();
  const typeByOriginalType = new Map<number, string>();
  for (const mt of mealType.getAll()) {
    typeNames.set(mt.uid, mt.name);
    // Only built-in types have a non-null originalType; custom types are
    // looked up by typeUid alone.
    if (mt.originalType !== null) {
      typeByOriginalType.set(mt.originalType, mt.name);
    }
  }

  const grouped = new Map<string, Array<{ typeName: string; entry: string }>>();
  for (const meal of meals) {
    const dateKey = meal.date.slice(0, 10);
    let entries = grouped.get(dateKey);
    if (entries === undefined) {
      entries = [];
      grouped.set(dateKey, entries);
    }
    entries.push(formatMealLine(meal, typeNames, typeByOriginalType));
  }

  const lines: Array<string> = [];
  for (const [dateKey, entries] of grouped) {
    const dt = DateTime.fromISO(dateKey, { zone: "utc" });
    const dayLabel = dt.isValid ? dt.toFormat("EEE dd") : dateKey;
    lines.push("");
    lines.push(`### ${dayLabel}`);

    const byType = new Map<string, Array<string>>();
    for (const { typeName, entry } of entries) {
      let typeEntries = byType.get(typeName);
      if (typeEntries === undefined) {
        typeEntries = [];
        byType.set(typeName, typeEntries);
      }
      typeEntries.push(entry);
    }
    for (const [typeName, typeEntries] of byType) {
      lines.push(`- **${typeName}** · ${typeEntries.join(", ")}`);
    }
  }
  return lines.join("\n");
}
