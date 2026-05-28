import type { Meal, MealType } from "../../paprika/types.js";
import type { MealUid, MealTypeUid } from "../../paprika/types.js";

let mealCounter = 0;
let mealTypeCounter = 0;

export function makeMeal(overrides?: Partial<Meal>): Meal {
  mealCounter++;
  const uid = (overrides?.uid ?? `meal-${String(mealCounter)}`) as MealUid;
  return {
    uid,
    recipeUid: null,
    name: `Meal ${String(mealCounter)}`,
    date: "2026-01-01 00:00:00",
    type: 2,
    typeUid: "dinner-uid",
    orderFlag: 0,
    isIngredient: false,
    scale: null,
    deleted: false,
    ...overrides,
  };
}

export function makeMealType(overrides?: Partial<MealType>): MealType {
  mealTypeCounter++;
  const uid = (overrides?.uid ?? `mealtype-${String(mealTypeCounter)}`) as MealTypeUid;
  return {
    uid,
    name: `MealType ${String(mealTypeCounter)}`,
    color: "",
    orderFlag: mealTypeCounter,
    originalType: mealTypeCounter - 1,
    exportAllDay: false,
    exportTime: 43200, // 12:00 = 12 * 3600 (seconds since midnight)
    deleted: false,
    ...overrides,
  };
}

export function makeSnakeCaseMeal(uid: string, overrides?: Partial<Record<string, unknown>>): object {
  return {
    uid,
    recipe_uid: null,
    name: `Meal ${uid}`,
    date: "2026-01-01 00:00:00",
    type: 2,
    type_uid: "dinner-uid",
    order_flag: 0,
    is_ingredient: false,
    scale: null,
    ...overrides,
  };
}

export function makeSnakeCaseMealType(uid: string, overrides?: Partial<Record<string, unknown>>): object {
  return {
    uid,
    name: `MealType ${uid}`,
    color: "",
    order_flag: 0,
    original_type: 0,
    export_all_day: false,
    export_time: 43200, // 12:00 = 12 * 3600 (seconds since midnight)
    ...overrides,
  };
}
