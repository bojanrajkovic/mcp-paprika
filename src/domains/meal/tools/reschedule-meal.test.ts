import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeUid, MealUid, RecipeUid } from "../../../ids.js";
import type { MealState } from "../module.js";
import type { Meal } from "../types.js";

import { makeMeal, makeMealType } from "../../../../test/cache/__fixtures__/meals.js";
import { makeRecipe } from "../../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { rescheduleMealInputSchema } from "./reschedule-meal.js";

const BREAKFAST_UID = "breakfast-uid" as MealTypeUid;
const LUNCH_UID = "lunch-uid" as MealTypeUid;
const DINNER_UID = "dinner-uid" as MealTypeUid;
const SNACKS_UID = "snacks-uid" as MealTypeUid;
const TACOS_UID = "tacos-recipe-uid" as RecipeUid;
const TEST_MEAL_UID = "reschedule-meal-1" as MealUid;

function makeBuiltins() {
  return [
    makeMealType({ uid: BREAKFAST_UID, name: "Breakfast", originalType: 0, orderFlag: 0 }),
    makeMealType({ uid: LUNCH_UID, name: "Lunch", originalType: 1, orderFlag: 1 }),
    makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 }),
    makeMealType({ uid: SNACKS_UID, name: "Snacks", originalType: 3, orderFlag: 3 }),
  ];
}

describe("reschedule_meal tool", () => {
  const kh = useKernelHarness("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("moves a meal to a new (empty) date — date updated, orderFlag reset to the destination's start", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation(async (items) => [...items]);
    const original = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: DINNER_UID,
      type: 2,
      name: "Sunday Roast",
      date: "2026-01-01 00:00:00",
      scale: "1.5",
      recipeUid: null,
      orderFlag: 3,
    });
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [original],
    });

    await kh.callTool("reschedule_meal", { uid: TEST_MEAL_UID, date: "2026-06-15" });

    const stored = (kh.state() as MealState).store.get(TEST_MEAL_UID);
    expect(stored?.date).toBe("2026-06-15 00:00:00");
    // Destination date is empty → first in its order_flag sequence (0). All other
    // non-date-derived fields are preserved.
    expect(stored).toEqual({ ...original, date: "2026-06-15 00:00:00", orderFlag: 0 });
  });

  it("moving onto a populated date — orderFlag becomes the destination date's max+1 (per-date)", async () => {
    // order_flag sequences per DATE: the moved meal must not collide with a meal
    // already holding flag 0 on the destination date.
    vi.mocked(kh.client().saveMeals).mockImplementation(async (items) => [...items]);
    const moving = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: LUNCH_UID,
      type: 1,
      date: "2026-06-10 00:00:00",
      orderFlag: 0,
    });
    const destExisting = makeMeal({
      uid: "existing-dinner-uid" as MealUid,
      typeUid: DINNER_UID,
      type: 2,
      date: "2026-06-15 00:00:00",
      orderFlag: 0,
    });
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [moving, destExisting],
    });

    await kh.callTool("reschedule_meal", { uid: TEST_MEAL_UID, date: "2026-06-15", type: { name: "Dinner" } });

    const stored = (kh.state() as MealState).store.get(TEST_MEAL_UID);
    expect(stored?.date).toBe("2026-06-15 00:00:00");
    expect(stored?.typeUid).toBe(DINNER_UID); // type co-change applied
    expect(stored?.orderFlag).toBe(1); // destination max (0) + 1, not the preserved 0

    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    expect(payload[0]?.orderFlag).toBe(1);
  });

  it("same date + type co-change — POSTs with the type applied and orderFlag preserved", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation(async (items) => [...items]);
    const original = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: LUNCH_UID,
      type: 1,
      date: "2026-06-15 00:00:00",
      orderFlag: 5,
    });
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [original],
    });

    await kh.callTool("reschedule_meal", { uid: TEST_MEAL_UID, date: "2026-06-15", type: { name: "Dinner" } });

    const stored = (kh.state() as MealState).store.get(TEST_MEAL_UID);
    expect(stored?.typeUid).toBe(DINNER_UID);
    expect(stored?.orderFlag).toBe(5); // same date → position preserved
    expect(kh.client().saveMeals).toHaveBeenCalledOnce();
  });

  it("same date + no type change — idempotent no-op (no POST or notifySync)", async () => {
    const original = makeMeal({
      uid: TEST_MEAL_UID,
      typeUid: DINNER_UID,
      type: 2,
      name: "Taco Tuesday",
      date: "2026-06-15 00:00:00",
      orderFlag: 2,
    });
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [original],
    });

    const result = await kh.callTool("reschedule_meal", { uid: TEST_MEAL_UID, date: "2026-06-15" });

    expect(kh.client().saveMeals).not.toHaveBeenCalled();
    expect(kh.client().notifySync).not.toHaveBeenCalled();
    expect(getText(result)).toContain("Taco Tuesday");
  });

  it("reports a not-found UID without saving", async () => {
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [],
    });

    const result = await kh.callTool("reschedule_meal", { uid: "ghost" as MealUid, date: "2026-06-15" });

    expect(getText(result)).toContain('No meal found with UID "ghost" (it may not exist or was already deleted).');
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("rejects an unparseable date without saving", async () => {
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [makeMeal({ uid: TEST_MEAL_UID, date: "2026-06-15 00:00:00" })],
    });

    const result = await kh.callTool("reschedule_meal", { uid: TEST_MEAL_UID, date: "not-a-date" });

    expect(getText(result)).toContain('Could not parse date "not-a-date"');
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  describe("input schema", () => {
    it("requires a date", () => {
      expect(rescheduleMealInputSchema.safeParse({ uid: TEST_MEAL_UID }).success).toBe(false);
    });

    it("rejects unknown keys (strict)", () => {
      expect(rescheduleMealInputSchema.safeParse({ uid: TEST_MEAL_UID, date: "2026-06-15", scale: "2" }).success).toBe(
        false,
      );
    });
  });
});

describe("reschedule_meal — meal-type auto-create no-orphan", () => {
  const kh = useKernelHarness("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("a rejected reschedule (bad date) with a new type {name} creates NO type", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation(async (items) => [...items]);
    vi.mocked(kh.client().saveMealType).mockImplementation(async (mt) => mt);
    kh.seed({
      meals: [makeMeal({ uid: TEST_MEAL_UID, typeUid: DINNER_UID, type: 2 })],
      mealTypes: makeBuiltins(),
      recipes: [],
    });

    const result = await kh.callTool("reschedule_meal", {
      uid: TEST_MEAL_UID,
      date: "not-a-date",
      type: { name: "Brunch" },
    });
    const text = getText(result);

    // The date is validated before the type is created → no orphan type.
    expect(text).toContain("Could not parse date");
    expect(kh.client().saveMealType).not.toHaveBeenCalled();
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });
});
