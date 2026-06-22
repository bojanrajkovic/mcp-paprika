import { DateTime } from "luxon";
import { z } from "zod";

import type { MealTypeApi } from "../../meal-type/api.js";
import type { RecipeApi } from "../../recipe/api.js";
import type { MealState } from "../module.js";
import type { Meal } from "../types.js";

import { sortCatalog } from "../../../shared/catalog.js";
import { MealTypeUidSchema } from "../../meal-type/ids.js";
import { RecipeUidSchema } from "../../recipe/ids.js";
import { MealUidSchema } from "../ids.js";
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
 * DANGLING reference (its type was deleted) and renders no type line
 * at all. `recipeUid: null` renders freeform.
 */
export function renderMealCard(meal: Readonly<Meal>, recipe: RecipeApi, mealType: MealTypeApi): string {
  const typeNameByUid = new Map<string, string>();
  for (const mt of mealType.getAll()) typeNameByUid.set(mt.uid, mt.name);
  const typeName = meal.typeUid !== null ? (typeNameByUid.get(meal.typeUid) ?? null) : `Type ${meal.type.toString()}`;
  const recipeName = meal.recipeUid !== null ? (recipe.get(meal.recipeUid)?.name ?? null) : null;
  return mealToMarkdown(meal, typeName, recipeName);
}

/**
 * Build the two meal-type lookup maps from the catalog in one pass: `byUid` (the
 * primary key) and `byOriginalType` (the legacy integer fallback for meals predating
 * the catalog, populated only for built-in types). Shared by the date-grouped text
 * renderer and the structured-row resolver so both read the catalog the same way.
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

function formatMealLine(
  meal: Readonly<Meal>,
  typeNames: Map<string, string>,
  typeByOriginalType: Map<number, string>,
): { typeName: string; entry: string } {
  // typeUid is the primary lookup, but older meals (predating Paprika's
  // mealtypes catalog) carry typeUid: null and rely on the `type` integer
  // (which corresponds to MealType.originalType in the catalog). A non-null
  // typeUid that misses the catalog is a DANGLING reference (its type was
  // deleted) and groups under "—" rather than a misleading Type N.
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
  const { byUid: typeNames, byOriginalType: typeByOriginalType } = mealTypeLookups(mealType);

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

/**
 * The structured-output row for one meal — the machine-readable
 * counterpart to `renderMealsGroupedByDate`'s human text, shared by `read_meal_plan`
 * and `search_meal_history`. The `uid` is the gap-closer: the rendered text omits it,
 * so without this row the model cannot drive `reschedule_meal` / `delete_meal` /
 * `update_meal` after a read. The fields are exactly what those follow-ups consume —
 * `recipeUid` / `typeUid` / `typeName` / `scale` let the model build an `update_meal`
 * partial without re-querying; `date` is the calendar day `reschedule_meal` takes.
 * The vestigial `type` integer, the internal `orderFlag`, and the non-actionable
 * `isIngredient` / `deleted` are deliberately omitted.
 */
export const mealRowSchema = z.object({
  uid: MealUidSchema,
  date: z.string().describe("Calendar day, yyyy-MM-dd."),
  name: z.string(),
  recipeUid: RecipeUidSchema.nullable().describe("Linked recipe UID, or null for a freeform meal."),
  typeUid: MealTypeUidSchema.nullable().describe("Meal-type UID, or null for a legacy meal predating the catalog."),
  typeName: z.string().nullable().describe("Resolved meal-type name, or null when the type is dangling/unknown."),
  scale: z.string().nullable(),
});

export type MealRow = z.infer<typeof mealRowSchema>;

/**
 * The `{ items }` structured-output wrapper shared by the meal-list reads:
 * `search_meal_history` returns it (`.extend()`ed with its pagination cursor).
 * `structuredContent` is a record, never a bare array, so the rows ride under `items` —
 * the tree-wide list convention. (`read_meal_plan` once shared this too, but its widget
 * surface needs the richer week payload below.)
 */
export const mealListOutputSchema = z.object({ items: z.array(mealRowSchema) });

/** One entry in the meal-week payload's meal-type registry. */
export const mealTypeRefSchema = z.object({ uid: MealTypeUidSchema, name: z.string() });

/**
 * `read_meal_plan`'s structured-output payload — a self-contained week the
 * meal-week-planner widget renders without a second `list_meal_types` call.
 * `weekStart` (Monday of the returned window) anchors the widget's prev/next navigation;
 * `meals` are the window's rows (shared {@link mealRowSchema}, with its denormalized
 * `typeName`); `mealTypes` is the catalog ordered by `orderFlag`, so an EMPTY day slot
 * still shows its meal-type label. Diverges from {@link mealListOutputSchema}: this read
 * is a week, not a flat list.
 */
export const mealWeekOutputSchema = z.object({
  weekStart: z
    .string()
    .describe("YYYY-MM-DD; Monday of the returned window — the meal-week-planner widget's navigation anchor."),
  meals: z.array(mealRowSchema),
  mealTypes: z
    .array(mealTypeRefSchema)
    .describe("Meal-type registry, ordered by orderFlag, for the widget's day-slot labels (empty slots included)."),
});

/**
 * Build the ordered meal-type registry for {@link mealWeekOutputSchema} via the shared
 * {@link sortCatalog} (orderFlag, ties broken by name) — the same order `list_meal_types`
 * uses, so the widget's day slots stack Breakfast → Lunch → Dinner → … consistently with
 * the rest of the surface, without the widget re-sorting.
 */
export function mealTypeRegistry(mealType: MealTypeApi): Array<z.infer<typeof mealTypeRefSchema>> {
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
