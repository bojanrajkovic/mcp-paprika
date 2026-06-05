import type { MealType } from "../../../../src/domains/meal-type/types.js";
import type { MealTypeUid } from "../../../../src/ids.js";

let mealTypeCounter = 0;

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
