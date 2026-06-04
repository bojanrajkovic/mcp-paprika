import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DateTime } from "luxon";
import { err, ok, type Result } from "neverthrow";

import type { MealTypeApi } from "../../meal-type/api.js";
import type { RecipeApi } from "../../recipe/api.js";
import type { MealSelf } from "../module.js";
import type { Meal } from "../types.js";

import { textResult } from "../../tools/helpers.js";
import { mealToMarkdown } from "../../tools/meal-helpers.js";

/**
 * Kernel-shaped meal helpers. The legacy `mealStartGuard`/`makeMealOrderFlagAssigner`/
 * `renderMealCard`/`renderMealsGroupedByDate` (`src/tools/meal-helpers.ts`) take the
 * god-object `ServerContext` and reach `ctx.mealStore`, `ctx.mealTypeStore`, and
 * `ctx.store` (recipe) directly. They are re-bound here to read this module's own
 * meal store via `self` and its declared deps' contracts (`ctx.deps.recipe`,
 * `ctx.deps["meal-type"]`). The meal-type spec resolution that lived in
 * `resolveMealTypeSpec(ctx, spec)` is now `deps["meal-type"].resolveSpec(spec)`
 * (the meal-type module owns that resolver and publishes it on its api), so it is
 * not re-implemented here. Logic is lifted verbatim; only the data sources change.
 *
 * The pure helpers (`mealToMarkdown`, `formatMealTypeResolveError`,
 * `mealTypeSpecSchema`) take no `ServerContext`, so the tool files import those
 * unchanged from `../../tools/meal-helpers.js`.
 */

/**
 * Both stores must be synced. The mealtype store is required by the type resolver
 * (`deps["meal-type"].resolveSpec`, used by both the write and read tools); without
 * it, every "Dinner" / "Lunch" lookup returns undefined and the user sees "Unknown
 * meal type" errors that look like input mistakes but are actually a cold-cache
 * state. Guarding both up front turns that into a clear "still syncing" message.
 * Lifted verbatim from `mealStartGuard`; meal store is `self`, meal-type is `deps`.
 */
export function mealStartGuard(self: MealSelf, mealType: MealTypeApi): Result<void, CallToolResult> {
  if (!self.store.hasSynced || !mealType.hasSynced()) {
    return err(textResult("Meal data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Builds a stateful, per-DATE `order_flag` assigner for a batch of new meals.
 * `order_flag` sequences PER CALENDAR DATE — all meal types on a given day share
 * one sequence, NOT a separate sequence per (date, type). `getMaxOrderFlagOn(date)`
 * seeds each date from the persisted store state; the returned closure then hands
 * out an increasing counter per date so multiple meals in ONE batch that share a
 * date get sequential flags. Lifted verbatim from `makeMealOrderFlagAssigner`;
 * reads `self.store`.
 */
export function makeMealOrderFlagAssigner(self: MealSelf): (date: string) => number {
  const next = new Map<string, number>();
  return (date) => {
    const flag = next.get(date) ?? (self.store.getMaxOrderFlagOn(date) ?? -1) + 1;
    next.set(date, flag + 1);
    return flag;
  };
}

/**
 * Resolve a meal's display names from the deps, then render its markdown card.
 * Wraps the pure `mealToMarkdown` with the lookups every meal-write response path
 * repeats: typeName from the meal-type catalog (`Type N` fallback for unknown or
 * legacy types), and recipeName from the recipe store. Meals with `typeUid: null`
 * (legacy) fall through to the integer-labelled fallback; `recipeUid: null` renders
 * freeform. Lifted verbatim from `renderMealCard`; meal-type via
 * `deps["meal-type"].getAll()`, recipe via `deps.recipe.get`.
 */
export function renderMealCard(meal: Readonly<Meal>, recipe: RecipeApi, mealType: MealTypeApi): string {
  const typeNameByUid = new Map<string, string>();
  for (const mt of mealType.getAll()) typeNameByUid.set(mt.uid, mt.name);
  const typeName =
    meal.typeUid !== null
      ? (typeNameByUid.get(meal.typeUid) ?? `Type ${meal.type.toString()}`)
      : `Type ${meal.type.toString()}`;
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
  // (which corresponds to MealType.originalType in the catalog).
  const lookup = meal.typeUid !== null ? typeNames.get(meal.typeUid) : typeByOriginalType.get(meal.type);
  const typeName = lookup ?? `Type ${meal.type.toString()}`;
  const isFreeform = meal.recipeUid === null || meal.recipeUid === "";
  const entry = isFreeform ? `${meal.name} *(freeform)*` : meal.name;
  return { typeName, entry };
}

/**
 * Render meals as a date-grouped calendar section: one `### EEE dd` heading per
 * calendar day — in the order the meals are supplied, so the CALLER controls
 * chronology — then one `- **Type** · entry, entry` bullet per meal type on that
 * day, with freeform meals annotated. Returns just the grouped body. Lifted
 * verbatim from `renderMealsGroupedByDate`; meal-type via `deps["meal-type"].getAll()`.
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
