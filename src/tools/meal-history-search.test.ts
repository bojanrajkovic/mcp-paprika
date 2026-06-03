import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";

import type { MealTypeUid, MealUid, RecipeUid } from "../ids.js";

import { makeMeal, makeMealType } from "../../test/cache/__fixtures__/meals.js";
import { makeCategory, makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerSearchMealHistoryTool, searchMealHistoryInputSchema } from "./meal-history-search.js";

const DINNER_UID = "dinner-uid" as MealTypeUid;
const LUNCH_UID = "lunch-uid" as MealTypeUid;
const PASTA_UID = "recipe-pasta" as RecipeUid;
const BURGER_UID = "recipe-burger" as RecipeUid;

function wireDay(offset: number): string {
  return DateTime.utc().startOf("day").plus({ days: offset }).toFormat("yyyy-MM-dd HH:mm:ss");
}
function ymd(offset: number): string {
  return DateTime.utc().startOf("day").plus({ days: offset }).toFormat("yyyy-MM-dd");
}

function setup() {
  const italian = makeCategory({ name: "Italian" });
  const { server, callTool } = makeTestServer();
  const ctx = seed(makeCtx(new RecipeStore(), server, {}), {
    categories: [italian],
    recipes: [
      makeRecipe({ uid: PASTA_UID, name: "Pasta", categories: [italian.uid] }),
      makeRecipe({ uid: BURGER_UID, name: "Burger", categories: [] }),
    ],
    mealTypes: [
      makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 }),
      makeMealType({ uid: LUNCH_UID, name: "Lunch", originalType: 1, orderFlag: 1 }),
    ],
    meals: [
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
      makeMeal({
        uid: "b-1" as MealUid,
        name: "Burger",
        recipeUid: BURGER_UID,
        date: wireDay(-1),
        typeUid: DINNER_UID,
        type: 2,
      }),
      makeMeal({
        uid: "lunch-1" as MealUid,
        name: "Sandwich",
        recipeUid: null,
        date: wireDay(-2),
        typeUid: LUNCH_UID,
        type: 1,
      }),
      makeMeal({
        uid: "old-1" as MealUid,
        name: "Old Stew",
        recipeUid: null,
        date: wireDay(-60),
        typeUid: DINNER_UID,
        type: 2,
      }),
    ],
  });
  registerSearchMealHistoryTool(server, ctx);
  return { callTool };
}

describe("search_meal_history tool", () => {
  it("by recipe_uid: only PAST meals, future excluded, with last-made", async () => {
    const text = getText(await setup().callTool("search_meal_history", { recipe_uid: PASTA_UID }));
    expect(text).toContain("2 past meals"); // p-old + p-recent; p-future excluded
    expect(text).toContain(`last made ${ymd(-3)}`);
  });

  it("by class: matches only meals whose recipe is in the category", async () => {
    const text = getText(await setup().callTool("search_meal_history", { class: "Italian" }));
    expect(text).toContain("2 past meals");
    expect(text).toContain('"Italian"');
    expect(text).toContain("Pasta");
    expect(text).not.toContain("Burger");
  });

  it("recipe_uid AND class match when the recipe is in the class", async () => {
    const text = getText(await setup().callTool("search_meal_history", { recipe_uid: PASTA_UID, class: "Italian" }));
    expect(text).toContain("2 past meals");
  });

  it("recipe_uid AND class yields nothing when the recipe is NOT in the class", async () => {
    const text = getText(await setup().callTool("search_meal_history", { recipe_uid: BURGER_UID, class: "Italian" }));
    expect(text).toContain("No past meals found");
  });

  it("by meal type: returns only meals of that type (incl. freeform)", async () => {
    const text = getText(await setup().callTool("search_meal_history", { type: { name: "Lunch" } }));
    expect(text).toContain("1 past meal");
    expect(text).toContain("Sandwich");
    expect(text).toContain('type "Lunch"');
    expect(text).not.toContain("Pasta");
  });

  it("explicit since/until restricts to the window (all meals, any recipe)", async () => {
    const text = getText(await setup().callTool("search_meal_history", { since: ymd(-4), until: ymd(-1) }));
    expect(text).toContain("3 past meals"); // p-recent(-3), lunch-1(-2), b-1(-1); p-old(-10) and old(-60) out
  });

  it("no filters → last 30 days (older meals excluded, future excluded)", async () => {
    const text = getText(await setup().callTool("search_meal_history", {}));
    expect(text).toContain("4 past meals"); // p-old(-10), p-recent(-3), lunch-1(-2), b-1(-1); old(-60) & future out
  });

  it("paginates with limit/offset", async () => {
    const page1 = getText(await setup().callTool("search_meal_history", { recipe_uid: PASTA_UID, limit: 1 }));
    expect(page1).toContain("Showing 1–1 of 2 past meals");
    const page2 = getText(
      await setup().callTool("search_meal_history", { recipe_uid: PASTA_UID, limit: 1, offset: 1 }),
    );
    expect(page2).toContain("Showing 2–2 of 2 past meals");
  });

  it("reports an unknown class", async () => {
    expect(getText(await setup().callTool("search_meal_history", { class: "Klingon" }))).toContain(
      'No category found matching "Klingon"',
    );
  });

  it("reports an unknown meal type via the shared formatter", async () => {
    expect(getText(await setup().callTool("search_meal_history", { type: { name: "Brunch" } }))).toContain(
      'Unknown meal type "Brunch"',
    );
  });

  it("reports no matches for a recipe never cooked", async () => {
    expect(
      getText(await setup().callTool("search_meal_history", { recipe_uid: "recipe-ghost" as RecipeUid })),
    ).toContain("No past meals found");
  });

  it("rejects unknown keys (strict schema)", () => {
    expect(searchMealHistoryInputSchema.safeParse({ recipe_uid: "x", bogus: 1 }).success).toBe(false);
  });
});
