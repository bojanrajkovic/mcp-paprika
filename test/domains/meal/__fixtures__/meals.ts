import type { MealTypeUid } from "../../../../src/domains/meal-type/ids.js";
import type { MealUid } from "../../../../src/domains/meal/ids.js";
import type { Meal } from "../../../../src/domains/meal/types.js";
import type { RecipeUid } from "../../../../src/domains/recipe/ids.js";

let mealCounter = 0;

// FK fields are loosened to plain strings so tests can pass literal UIDs; the
// fixture brands them (the mint is centralized here, not at every call site).
// Nullable FKs with a non-null default use `=== undefined` (not `??`) so an
// explicit `null` override is preserved rather than collapsed back to the default.
type MealOverrides = Partial<Omit<Meal, "recipeUid" | "typeUid">> & {
  readonly recipeUid?: string | null;
  readonly typeUid?: string | null;
};

export function makeMeal(overrides?: MealOverrides): Meal {
  mealCounter++;
  const { recipeUid, typeUid, ...rest } = overrides ?? {};
  return {
    uid: `meal-${String(mealCounter)}` as MealUid,
    recipeUid: (recipeUid ?? null) as RecipeUid | null,
    name: `Meal ${String(mealCounter)}`,
    date: "2026-01-01 00:00:00",
    type: 2,
    typeUid: (typeUid === undefined ? "dinner-uid" : typeUid) as MealTypeUid | null,
    orderFlag: 0,
    isIngredient: false,
    scale: null,
    deleted: false,
    ...rest,
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
