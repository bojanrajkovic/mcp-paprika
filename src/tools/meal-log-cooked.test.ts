import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import type { SeedData } from "../../test/support/tool-test-utils.js";
import type { MealTypeUid, MealUid, RecipeUid } from "../ids.js";
import type { Meal } from "../meal/types.js";

import { makeMeal, makeMealType } from "../../test/cache/__fixtures__/meals.js";
import { makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { todayWire } from "../utils/dates.js";
import { logCookedMealInputSchema, registerLogCookedMealTool } from "./meal-log-cooked.js";

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

function setup(meals?: NonNullable<SeedData["meals"]>) {
  const saveMeals = vi.fn().mockImplementation(async (items: ReadonlyArray<Meal>) => items);
  const notifySync = vi.fn().mockResolvedValue(undefined);
  const { server, callTool } = makeTestServer();
  const ctx = seed(
    makeCtx(new RecipeStore(), server, {
      client: fromAny({ saveMeals, notifySync }),
      cache: fromAny({ meals: { put: vi.fn(), remove: vi.fn() }, flush: vi.fn().mockResolvedValue(undefined) }),
    }),
    {
      mealTypes: makeBuiltins(),
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" })],
      meals: meals ?? [], // always seed (even empty) so mealStore is marked synced
    },
  );
  registerLogCookedMealTool(server, ctx);
  return { callTool, saveMeals };
}

/** The single Meal handed to the saveMeals stub. */
function savedMeal(saveMeals: ReturnType<typeof vi.fn>): Meal {
  const items = saveMeals.mock.calls[0]![0] as ReadonlyArray<Meal>;
  return items[0]!;
}

describe("log_cooked_meal tool", () => {
  it("defaults to today and Dinner, linking the given recipe", async () => {
    const { callTool, saveMeals } = setup();

    await callTool("log_cooked_meal", { recipe_uid: TACOS_UID });

    const meal = savedMeal(saveMeals);
    expect(meal.recipeUid).toBe(TACOS_UID);
    expect(meal.name).toBe("Tacos"); // denormalized from the recipe
    expect(meal.date).toBe(todayWire()); // today at midnight
    expect(meal.typeUid).toBe(DINNER_UID);
    expect(meal.type).toBe(2);
  });

  it("honors an explicit date and type", async () => {
    const { callTool, saveMeals } = setup();

    await callTool("log_cooked_meal", { recipe_uid: TACOS_UID, type: { name: "Lunch" }, date: "2026-06-15" });

    const meal = savedMeal(saveMeals);
    expect(meal.date).toBe("2026-06-15 00:00:00");
    expect(meal.typeUid).toBe(LUNCH_UID);
    expect(meal.type).toBe(1);
  });

  it("assigns the next per-date order_flag", async () => {
    const existing = makeMeal({
      uid: "ex" as MealUid,
      date: todayWire(),
      orderFlag: 0,
      typeUid: DINNER_UID,
      type: 2,
    });
    const { callTool, saveMeals } = setup([existing]);

    await callTool("log_cooked_meal", { recipe_uid: TACOS_UID });

    expect(savedMeal(saveMeals).orderFlag).toBe(1); // max on today (0) + 1
  });

  it("rejects an unknown recipe_uid without saving", async () => {
    const { callTool, saveMeals } = setup();

    const result = await callTool("log_cooked_meal", { recipe_uid: "recipe-ghost" as RecipeUid });

    expect(getText(result)).toContain("is not known to the local recipe store");
    expect(saveMeals).not.toHaveBeenCalled();
  });

  it("rejects an unparseable date without saving", async () => {
    const { callTool, saveMeals } = setup();

    const result = await callTool("log_cooked_meal", { recipe_uid: TACOS_UID, date: "not-a-date" });

    expect(getText(result)).toContain('Could not parse date "not-a-date"');
    expect(saveMeals).not.toHaveBeenCalled();
  });

  it("rejects unknown keys (strict schema)", () => {
    expect(logCookedMealInputSchema.safeParse({ recipe_uid: TACOS_UID, scale: "2" }).success).toBe(false);
  });
});
