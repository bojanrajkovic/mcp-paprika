import { DateTime } from "luxon";
import { TombstoneEntityStore } from "../entity/index.js";
import type { Meal, MealUid } from "../paprika/types.js";

export interface MealDateRangeOpts {
  readonly since?: DateTime | undefined;
  readonly until?: DateTime | undefined;
  readonly recipeUid?: string | undefined;
  readonly typeUid?: string | undefined;
  /**
   * When `typeUid` resolves to a built-in mealtype (Breakfast/Lunch/Dinner/
   * Snacks — those with non-null `originalType`), pass the integer here so
   * legacy meals (predating Paprika's user-customizable mealtypes catalog —
   * i.e. `meal.typeUid === null`) with a matching `meal.type` integer are
   * also returned. Omit for custom-type filters; legacy meals have no UID
   * relationship to custom types.
   */
  readonly legacyTypeInteger?: number | undefined;
  readonly offset?: number | undefined;
  readonly limit?: number | undefined;
}

export interface MealDateRangeResult {
  readonly meals: ReadonlyArray<Meal>;
  readonly total: number;
}

function parseMealDate(date: string): DateTime {
  return DateTime.fromFormat(date, "yyyy-MM-dd HH:mm:ss", { zone: "utc" });
}

// Should the meal be hidden from all history queries?
// `deleted: true` items can land in the in-memory store via syncReplaceAllEntity
// (the sync engine loads every wire item; tombstone filtering is the query
// layer's job). `isIngredient: true` items are prep-work entries, not served
// meals — see lastCookedAt comment for the rationale.
function isHidden(meal: Meal): boolean {
  return meal.deleted || meal.isIngredient;
}

function matchesTypeFilter(meal: Meal, opts: MealDateRangeOpts): boolean {
  if (opts.typeUid === undefined) return true;
  if (meal.typeUid === opts.typeUid) return true;
  // Legacy meals (typeUid: null) carry only the integer `type`. When the
  // caller targets a built-in, accept legacy meals whose integer matches.
  if (meal.typeUid === null && opts.legacyTypeInteger !== undefined && meal.type === opts.legacyTypeInteger) {
    return true;
  }
  return false;
}

export class MealStore extends TombstoneEntityStore<Meal, MealUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  getByRecipeUid(recipeUid: string): Array<Meal> {
    const result: Array<Meal> = [];
    for (const meal of this._items.values()) {
      if (isHidden(meal)) continue;
      if (meal.recipeUid === recipeUid) {
        result.push(meal);
      }
    }
    return result;
  }

  lastCookedAt(recipeUid: string): string | null {
    let latest: string | null = null;
    let latestDt: DateTime | null = null;

    for (const meal of this._items.values()) {
      if (isHidden(meal)) continue;
      if (meal.recipeUid !== recipeUid) continue;
      const dt = parseMealDate(meal.date);
      if (!dt.isValid) continue;
      if (latestDt === null || dt > latestDt) {
        latestDt = dt;
        latest = meal.date;
      }
    }

    return latest;
  }

  getInDateRange(opts?: MealDateRangeOpts): MealDateRangeResult {
    const filtered: Array<{ meal: Meal; dt: DateTime }> = [];

    for (const meal of this._items.values()) {
      if (isHidden(meal)) continue;

      if (opts?.recipeUid !== undefined && meal.recipeUid !== opts.recipeUid) continue;
      if (opts !== undefined && !matchesTypeFilter(meal, opts)) continue;

      const dt = parseMealDate(meal.date);
      if (!dt.isValid) continue;

      if (opts?.since !== undefined && dt < opts.since) continue;
      if (opts?.until !== undefined && dt > opts.until) continue;

      filtered.push({ meal, dt });
    }

    filtered.sort((a, b) => {
      const dateCmp = b.dt.toMillis() - a.dt.toMillis();
      if (dateCmp !== 0) return dateCmp;
      return a.meal.type - b.meal.type;
    });

    const total = filtered.length;
    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 50;
    const meals = filtered.slice(offset, offset + limit).map((entry) => entry.meal);

    return { meals, total };
  }
}
