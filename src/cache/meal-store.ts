import { DateTime } from "luxon";
import { TombstoneEntityStore } from "../entity/index.js";
import type { Meal, MealUid, RecipeUid, MealTypeUid } from "../paprika/types.js";

export interface MealDateRangeOpts {
  readonly since?: DateTime | undefined;
  readonly until?: DateTime | undefined;
  readonly recipeUid?: RecipeUid | undefined;
  readonly typeUid?: MealTypeUid | undefined;
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

  getByRecipeUid(recipeUid: RecipeUid): Array<Meal> {
    const result: Array<Meal> = [];
    for (const meal of this._items.values()) {
      if (isHidden(meal)) continue;
      if (meal.recipeUid === recipeUid) {
        result.push(meal);
      }
    }
    return result;
  }

  lastCookedAt(recipeUid: RecipeUid, nowUtc: DateTime = DateTime.utc()): string | null {
    let latest: string | null = null;
    let latestDt: DateTime | null = null;

    for (const meal of this._items.values()) {
      if (isHidden(meal)) continue;
      if (meal.recipeUid !== recipeUid) continue;
      const dt = parseMealDate(meal.date);
      if (!dt.isValid) continue;
      // Exclude future planner entries — "last cooked" means actually eaten,
      // not scheduled. A planner entry dated next Tuesday shouldn't surface
      // as a recipe's most-recent cooking date.
      if (dt > nowUtc) continue;
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

  /**
   * Returns the highest `orderFlag` among non-deleted, non-ingredient meals
   * matching (date, typeUid). Returns null when no matching meal exists; callers
   * use `(result ?? -1) + 1` to compute the next flag for an append.
   *
   * Date is matched exactly against the Paprika wire-format date string (the
   * caller is responsible for normalizing input through toWireDateFormat first).
   * typeUid is matched exactly, including null — meals with typeUid: null
   * (legacy entries predating Paprika's mealtypes catalog) form their own bucket
   * per date and never collide with non-null typeUid buckets on the same date.
   *
   * Unlike the recipe/type filters on the read methods, `typeUid` here stays
   * plain `string | null` (not branded `MealTypeUid`): update_meal computes the
   * destination bucket from the *existing* meal's `typeUid` when the type isn't
   * changing, and `Meal.typeUid` is the untrusted plain-string wire field — so
   * branding the parameter would only force a cast back at that call site.
   *
   * Pending-delete UIDs are excluded: between `markPendingDelete` and
   * `delete`, the meal is still in `_items` with `deleted: false` (commitMeal
   * doesn't mutate the entry, just the pending-writes set). Without this filter
   * a soft-delete + same-bucket add_meals within the cache-flush window would
   * inflate the new meal's `orderFlag` by counting the soon-to-be-gone meal.
   */
  getMaxOrderFlagOn(date: string, typeUid: string | null): number | null {
    let max: number | null = null;
    for (const meal of this._items.values()) {
      if (isHidden(meal)) continue;
      if (this.isPendingDelete(meal.uid)) continue;
      if (meal.date !== date) continue;
      if (meal.typeUid !== typeUid) continue;
      if (max === null || meal.orderFlag > max) {
        max = meal.orderFlag;
      }
    }
    return max;
  }
}
