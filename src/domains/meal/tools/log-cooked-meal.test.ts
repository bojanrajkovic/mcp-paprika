import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeUid } from "../../meal-type/ids.js";
import type { RecipeUid } from "../../recipe/ids.js";
import type { MealUid } from "../ids.js";
import type { MealState } from "../module.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMeal } from "../../../../test/domains/meal/__fixtures__/meals.js";
import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { todayWire } from "../../../utils/dates.js";
import { logCookedMealInputSchema } from "./log-cooked-meal.js";

const BREAKFAST_UID = "breakfast-uid" as MealTypeUid;
const LUNCH_UID = "lunch-uid" as MealTypeUid;
const DINNER_UID = "dinner-uid" as MealTypeUid;
const SNACKS_UID = "snacks-uid" as MealTypeUid;
const TACOS_UID = "tacos-recipe-uid" as RecipeUid;

function makeBuiltins() {
  return [
    makeMealType({ uid: BREAKFAST_UID, name: "Breakfast", originalType: 0, orderFlag: 0 }),
    makeMealType({ uid: LUNCH_UID, name: "Lunch", originalType: 1, orderFlag: 1 }),
    makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 }),
    makeMealType({ uid: SNACKS_UID, name: "Snacks", originalType: 3, orderFlag: 3 }),
  ];
}

describe("log_cooked_meal tool", () => {
  const kh = useKernelHarness<MealState>("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("defaults to today and Dinner, linking the given recipe", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [],
    });

    await kh.callTool("log_cooked_meal", { recipe_uid: TACOS_UID });

    const savedMeals = vi.mocked(kh.client().saveMeals).mock.calls[0]![0] as ReadonlyArray<{
      recipeUid: string;
      name: string;
      date: string;
      typeUid: string;
      type: number;
    }>;
    const meal = savedMeals[0]!;
    expect(meal.recipeUid).toBe(TACOS_UID);
    expect(meal.name).toBe("Tacos"); // denormalized from the recipe
    expect(meal.date).toBe(todayWire()); // today at midnight
    expect(meal.typeUid).toBe(DINNER_UID);
    expect(meal.type).toBe(2);
  });

  it("honors an explicit date and type", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [],
    });

    await kh.callTool("log_cooked_meal", { recipe_uid: TACOS_UID, type: { name: "Lunch" }, date: "2026-06-15" });

    const savedMeals = vi.mocked(kh.client().saveMeals).mock.calls[0]![0] as ReadonlyArray<{
      date: string;
      typeUid: string;
      type: number;
    }>;
    const meal = savedMeals[0]!;
    expect(meal.date).toBe("2026-06-15 00:00:00");
    expect(meal.typeUid).toBe(LUNCH_UID);
    expect(meal.type).toBe(1);
  });

  it("assigns the next per-date order_flag", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    const existing = makeMeal({
      uid: "ex" as MealUid,
      date: todayWire(),
      orderFlag: 0,
      typeUid: DINNER_UID,
      type: 2,
    });
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [existing],
    });

    await kh.callTool("log_cooked_meal", { recipe_uid: TACOS_UID });

    const savedMeals = vi.mocked(kh.client().saveMeals).mock.calls[0]![0] as ReadonlyArray<{ orderFlag: number }>;
    expect(savedMeals[0]!.orderFlag).toBe(1); // max on today (0) + 1
  });

  it("rejects an unknown recipe_uid without saving", async () => {
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [],
    });

    const result = await kh.callTool("log_cooked_meal", { recipe_uid: "recipe-ghost" as RecipeUid });

    expect(getText(result)).toContain("is not known to the local recipe store");
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("rejects an unparseable date without saving", async () => {
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [],
    });

    const result = await kh.callTool("log_cooked_meal", { recipe_uid: TACOS_UID, date: "not-a-date" });

    expect(getText(result)).toContain('Could not parse date "not-a-date"');
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("rejects unknown keys (strict schema)", () => {
    expect(logCookedMealInputSchema.safeParse({ recipe_uid: TACOS_UID, scale: "2" }).success).toBe(false);
  });

  it("commits the saved meal to the store", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    kh.seed({
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: [],
    });

    await kh.callTool("log_cooked_meal", { recipe_uid: TACOS_UID });

    const store = kh.state().store;
    expect(store.size).toBe(1);
  });

  it("a rejected log (unknown recipe) with a new type {name} creates NO type", async () => {
    vi.mocked(kh.client().saveMeals).mockImplementation((items) => okAsync([...items]));
    vi.mocked(kh.client().saveMealType).mockImplementation((mt) => okAsync(mt));
    kh.seed({ mealTypes: makeBuiltins(), recipes: [], meals: [] });

    const result = await kh.callTool("log_cooked_meal", {
      recipe_uid: "ghost-recipe" as RecipeUid,
      type: { name: "Brunch" },
    });
    const text = getText(result);

    // The recipe is validated before the type is created → no orphan type.
    expect(text).toContain("is not known to the local recipe store");
    expect(kh.client().saveMealType).not.toHaveBeenCalled();
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });
});
