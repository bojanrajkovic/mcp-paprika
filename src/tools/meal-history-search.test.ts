import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import type { MealTypeUid, MealUid, RecipeUid } from "../ids.js";

import { makeMeal, makeMealType } from "../../test/cache/__fixtures__/meals.js";
import { makeCategory, makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerSearchMealHistoryTool } from "./meal-history-search.js";

const DINNER_UID = "dinner-uid" as MealTypeUid;
const PASTA_UID = "recipe-pasta" as RecipeUid;
const BURGER_UID = "recipe-burger" as RecipeUid;

function wireDay(offsetDays: number): string {
  return DateTime.utc().startOf("day").plus({ days: offsetDays }).toFormat("yyyy-MM-dd HH:mm:ss");
}
function ymd(offsetDays: number): string {
  return DateTime.utc().startOf("day").plus({ days: offsetDays }).toFormat("yyyy-MM-dd");
}

function setup() {
  const italian = makeCategory({ name: "Italian" });
  const pasta = makeRecipe({ uid: PASTA_UID, name: "Pasta", categories: [italian.uid] });
  const burger = makeRecipe({ uid: BURGER_UID, name: "Burger", categories: [] });
  const { server, callTool } = makeTestServer();
  const ctx = seed(makeCtx(new RecipeStore(), server, {}), {
    categories: [italian],
    recipes: [pasta, burger],
    mealTypes: [makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 })],
    meals: [
      // Past pasta meals (the most recent is 3 days ago) + one FUTURE pasta meal.
      makeMeal({
        uid: "p-old" as MealUid,
        name: "Pasta",
        recipeUid: PASTA_UID,
        date: wireDay(-10),
        typeUid: DINNER_UID,
        type: 2,
      }),
      makeMeal({
        uid: "p-recent" as MealUid,
        name: "Pasta",
        recipeUid: PASTA_UID,
        date: wireDay(-3),
        typeUid: DINNER_UID,
        type: 2,
      }),
      makeMeal({
        uid: "p-future" as MealUid,
        name: "Pasta",
        recipeUid: PASTA_UID,
        date: wireDay(5),
        typeUid: DINNER_UID,
        type: 2,
      }),
      // A past burger meal (NOT in the Italian category).
      makeMeal({
        uid: "b-1" as MealUid,
        name: "Burger",
        recipeUid: BURGER_UID,
        date: wireDay(-1),
        typeUid: DINNER_UID,
        type: 2,
      }),
    ],
  });
  registerSearchMealHistoryTool(server, ctx);
  return { callTool };
}

describe("search_meal_history tool", () => {
  it("by recipe_uid: counts only PAST meals and reports last-made (future excluded)", async () => {
    const text = getText(await setup().callTool("search_meal_history", { recipe_uid: PASTA_UID }));
    expect(text).toContain("2 past meals"); // p-old + p-recent; p-future excluded
    expect(text).toContain(`last made ${ymd(-3)}`);
  });

  it("by class: matches only meals whose recipe is in the category", async () => {
    const text = getText(await setup().callTool("search_meal_history", { class: "Italian" }));
    expect(text).toContain("2 past meals"); // both past Pasta meals; Burger (not Italian) excluded
    expect(text).toContain("Italian");
    expect(text).toContain("Pasta");
    expect(text).not.toContain("Burger");
  });

  it("recipe_uid AND class both match when the recipe is in the class", async () => {
    const text = getText(await setup().callTool("search_meal_history", { recipe_uid: PASTA_UID, class: "Italian" }));
    expect(text).toContain("2 past meals");
  });

  it("recipe_uid AND class yields nothing when the recipe is NOT in the class", async () => {
    const text = getText(await setup().callTool("search_meal_history", { recipe_uid: BURGER_UID, class: "Italian" }));
    expect(text).toContain("No past meals found");
  });

  it("reports an unknown class", async () => {
    const text = getText(await setup().callTool("search_meal_history", { class: "Klingon" }));
    expect(text).toContain('No category found matching "Klingon"');
  });

  it("requires at least one of recipe_uid or class", async () => {
    const text = getText(await setup().callTool("search_meal_history", {}));
    expect(text).toContain("Provide at least one");
  });

  it("reports no matches for a recipe never cooked", async () => {
    const text = getText(await setup().callTool("search_meal_history", { recipe_uid: "recipe-ghost" as RecipeUid }));
    expect(text).toContain("No past meals found");
  });
});
