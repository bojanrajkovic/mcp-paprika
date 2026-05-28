import { DateTime } from "luxon";
import { TombstoneEntityStore } from "../entity/index.js";
import type { Meal, MealUid } from "../paprika/types.js";

export interface MealDateRangeOpts {
  readonly since?: DateTime | undefined;
  readonly until?: DateTime | undefined;
  readonly recipeUid?: string | undefined;
  readonly typeUid?: string | undefined;
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

export class MealStore extends TombstoneEntityStore<Meal, MealUid> {
  constructor(opts?: { readonly pendingWriteTtlMs?: number }) {
    super(opts ?? {});
  }

  getByRecipeUid(recipeUid: string): Array<Meal> {
    const result: Array<Meal> = [];
    for (const meal of this._items.values()) {
      if (meal.recipeUid === recipeUid && !meal.isIngredient) {
        result.push(meal);
      }
    }
    return result;
  }

  lastCookedAt(recipeUid: string): string | null {
    let latest: string | null = null;
    let latestDt: DateTime | null = null;

    for (const meal of this._items.values()) {
      if (meal.recipeUid !== recipeUid || meal.isIngredient) continue;
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
      if (meal.isIngredient) continue;

      if (opts?.recipeUid !== undefined && meal.recipeUid !== opts.recipeUid) continue;
      if (opts?.typeUid !== undefined && meal.typeUid !== opts.typeUid) continue;

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
