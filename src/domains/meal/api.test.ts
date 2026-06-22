import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MealApi } from "./api.js";
import type { Meal } from "./types.js";

import { makeMealType } from "../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMeal } from "../../../test/domains/meal/__fixtures__/meals.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";
import { MealTypeUidSchema } from "../meal-type/ids.js";
import { MealUidSchema } from "./ids.js";

const DINNER_UID = MealTypeUidSchema.parse("11111111-1111-4111-8111-111111111111");

/**
 * Drives `MealApi.toStructuredRows` against the real built module: the cross-domain row
 * projection schedule_menu consumes via `ctx.deps.meal`. The harness builds the meal
 * module with its real meal-type dep, so the method resolves type names through the
 * live catalog exactly as it does in production.
 */
describe("MealApi.toStructuredRows", () => {
  const kh = useKernelHarness("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("projects meals to structured rows, resolving the type name through the live catalog", () => {
    kh.seed({
      mealTypes: [makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 })],
      meals: [],
    });
    const api = kh.apiOf("meal") as MealApi;

    const meal: Meal = makeMeal({
      uid: MealUidSchema.parse("22222222-2222-4222-8222-222222222222"),
      name: "Tacos",
      date: "2026-06-15 00:00:00",
      typeUid: DINNER_UID,
      type: 2,
      recipeUid: null,
      scale: null,
    });

    expect(api.toStructuredRows([meal])).toEqual([
      {
        uid: meal.uid,
        date: "2026-06-15",
        name: "Tacos",
        recipeUid: null,
        typeUid: DINNER_UID,
        typeName: "Dinner",
        scale: null,
      },
    ]);
  });

  it("resolves typeName to null when the meal's type is dangling/unknown", () => {
    kh.seed({ mealTypes: [], meals: [] });
    const api = kh.apiOf("meal") as MealApi;

    const meal: Meal = makeMeal({
      uid: MealUidSchema.parse("33333333-3333-4333-8333-333333333333"),
      name: "Mystery",
      date: "2026-06-16 00:00:00",
      typeUid: DINNER_UID,
      type: 2,
    });

    expect(api.toStructuredRows([meal])[0]?.typeName).toBeNull();
  });

  it("returns an empty array for no meals", () => {
    kh.seed({ mealTypes: [], meals: [] });
    const api = kh.apiOf("meal") as MealApi;
    expect(api.toStructuredRows([])).toEqual([]);
  });
});
