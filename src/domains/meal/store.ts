import { DateTime } from "luxon";

import type { MealTypeUid, MealUid, RecipeUid } from "../../ids.js";
import type { Meal } from "./types.js";

import { EntityStore } from "../../entity/index.js";

export interface MealDateRangeOpts {
  readonly since?: DateTime | undefined;
  readonly until?: DateTime | undefined;
  readonly recipeUid?: RecipeUid | undefined;
  /**
   * Restrict to meals whose recipe is in this set (recipe-linked only). Used by
   * search_meal_history to filter by a specific recipe and/or a category's recipe
   * set; a freeform meal (recipeUid null) never matches. Composes (AND) with the
   * other filters.
   */
  readonly recipeUids?: ReadonlySet<RecipeUid> | undefined;
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

// Should the meal be hidden from all history queries? `isIngredient: true` items
// are prep-work entries, not served meals — see lastCookedAt comment for the rationale.
function isHidden(meal: Meal): boolean {
  return meal.isIngredient;
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

export class MealStore extends EntityStore<Meal, MealUid> {
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

  /**
   * One recipe's cooking history — its PAST, non-hidden cooks, newest first. The
   * canonical "have we cooked this, and when" list, and the sequence
   * `lastCookedAt` reports the head of. Built on `getByRecipeUid` so the
   * non-ingredient + recipe-link rule lives in one place, then drops future
   * planner entries ("last cooked" means actually eaten, not scheduled — a meal
   * dated next Tuesday is not something we've cooked) and unparseable dates, and
   * sorts date-descending.
   */
  cookedHistory(recipeUid: RecipeUid, nowUtc: DateTime = DateTime.utc()): Array<Meal> {
    return this.getByRecipeUid(recipeUid)
      .map((meal) => ({ meal, dt: parseMealDate(meal.date) }))
      .filter(({ dt }) => dt.isValid && dt <= nowUtc)
      .sort((a, b) => b.dt.toMillis() - a.dt.toMillis())
      .map(({ meal }) => meal);
  }

  /**
   * The most recent PAST cooking date for a recipe (wire-format string), or null
   * if it has never been cooked — the head of `cookedHistory`.
   */
  lastCookedAt(recipeUid: RecipeUid, nowUtc: DateTime = DateTime.utc()): string | null {
    return this.cookedHistory(recipeUid, nowUtc)[0]?.date ?? null;
  }

  getInDateRange(opts?: MealDateRangeOpts): MealDateRangeResult {
    const filtered: Array<{ meal: Meal; dt: DateTime }> = [];

    for (const meal of this._items.values()) {
      if (isHidden(meal)) continue;

      if (opts?.recipeUid !== undefined && meal.recipeUid !== opts.recipeUid) continue;
      if (opts?.recipeUids !== undefined && (meal.recipeUid === null || !opts.recipeUids.has(meal.recipeUid))) continue;
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
   * Returns the highest `orderFlag` among non-deleted, non-ingredient meals on
   * `date`, across ALL meal types on that day. Returns null when no meal exists
   * on the date; callers use `(result ?? -1) + 1` to compute the next flag for
   * an append.
   *
   * `order_flag` sequences PER CALENDAR DATE, not per (date, type): all meal
   * types on a given day share one ordering sequence. The wire capture is
   * decisive — two same-date meals of different types post as `order_flag` 0
   * and 1, while two same-type meals on different dates both post as 0
   * (`docs/wire-captures/meals.har.json`). So this method matches on `date`
   * only; meal type does not partition the sequence.
   *
   * Date is matched exactly against the Paprika wire-format date string (the
   * caller is responsible for normalizing input through `parseCalendarDayWire`
   * first).
   *
   * Pending-delete UIDs are excluded: between `markPendingDelete` and
   * `delete`, the meal is still in `_items` with `deleted: false` (commitMeal
   * doesn't mutate the entry, just the pending-writes set). Without this filter
   * a soft-delete + same-date add within the cache-flush window would inflate
   * the new meal's `orderFlag` by counting the soon-to-be-gone meal.
   */
  getMaxOrderFlagOn(date: string): number | null {
    let max: number | null = null;
    for (const meal of this._items.values()) {
      if (isHidden(meal)) continue;
      if (this.isPendingDelete(meal.uid)) continue;
      if (meal.date !== date) continue;
      if (max === null || meal.orderFlag > max) {
        max = meal.orderFlag;
      }
    }
    return max;
  }
}
