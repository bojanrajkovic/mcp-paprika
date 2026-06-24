import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MealTypeUid } from "../../meal-type/ids.js";
import type { RecipeUid } from "../../recipe/ids.js";
import type { MealUid } from "../ids.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMeal } from "../../../../test/domains/meal/__fixtures__/meals.js";
import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getJson, getText } from "../../../../test/support/tool-test-utils.js";
import { searchMealHistoryInputSchema } from "./search-meal-history.js";

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

describe("search_meal_history tool", () => {
  const kh = useKernelHarness("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  function seedAll(): void {
    const italian = makeCategory({ name: "Italian" });
    kh.seed({
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
  }

  it("by recipe_uid: only past meals, future excluded, with last-made", async () => {
    seedAll();
    const json = await kh.callToolJson<{ items: Array<{ uid: string; date: string }>; total: number; offset: number }>(
      "search_meal_history",
      { recipe_uid: PASTA_UID },
    );
    expect(json.total).toBe(2); // p-old + p-recent; p-future excluded
    // Most recent first — p-recent (-3 days) has the later date
    expect(json.items[0]!.date).toBe(ymd(-3));
  });

  it("by class: matches only meals whose recipe is in the category", async () => {
    seedAll();
    const json = await kh.callToolJson<{ items: Array<{ name: string }>; total: number }>("search_meal_history", {
      class: "Italian",
    });
    expect(json.total).toBe(2);
    const names = json.items.map((i) => i.name);
    expect(names).toContain("Pasta");
    expect(names).not.toContain("Burger");
  });

  it("recipe_uid AND class match when the recipe is in the class", async () => {
    seedAll();
    const json = await kh.callToolJson<{ total: number }>("search_meal_history", {
      recipe_uid: PASTA_UID,
      class: "Italian",
    });
    expect(json.total).toBe(2);
  });

  it("recipe_uid AND class yields nothing when the recipe is not in the class", async () => {
    seedAll();
    const json = await kh.callToolJson<{ items: unknown[]; total: number }>("search_meal_history", {
      recipe_uid: BURGER_UID,
      class: "Italian",
    });
    expect(json.total).toBe(0);
    expect(json.items).toEqual([]);
  });

  it("by meal type: returns only meals of that type including freeform", async () => {
    seedAll();
    const json = await kh.callToolJson<{ items: Array<{ name: string; typeName: string }>; total: number }>(
      "search_meal_history",
      { type: { name: "Lunch" } },
    );
    expect(json.total).toBe(1);
    const names = json.items.map((i) => i.name);
    expect(names).toContain("Sandwich");
    expect(names).not.toContain("Pasta");
    expect(json.items[0]!.typeName).toBe("Lunch");
  });

  it("explicit since/until restricts to the window", async () => {
    seedAll();
    const json = await kh.callToolJson<{ total: number }>("search_meal_history", { since: ymd(-4), until: ymd(-1) });
    expect(json.total).toBe(3); // p-recent(-3), lunch-1(-2), b-1(-1); p-old(-10) and old(-60) out
  });

  it("no filters returns last 30 days with older and future meals excluded", async () => {
    seedAll();
    const json = await kh.callToolJson<{ total: number }>("search_meal_history", {});
    expect(json.total).toBe(4); // p-old(-10), p-recent(-3), lunch-1(-2), b-1(-1); old(-60) & future out
  });

  it("paginates with limit and offset", async () => {
    seedAll();
    const page1 = await kh.callToolJson<{ items: Array<{ uid: string }>; total: number; offset: number }>(
      "search_meal_history",
      { recipe_uid: PASTA_UID, limit: 1 },
    );
    expect(page1.total).toBe(2);
    expect(page1.items).toHaveLength(1);
    expect(page1.offset).toBe(0);
    const page2 = await kh.callToolJson<{ items: Array<{ uid: string }>; total: number; offset: number }>(
      "search_meal_history",
      { recipe_uid: PASTA_UID, limit: 1, offset: 1 },
    );
    expect(page2.total).toBe(2);
    expect(page2.items).toHaveLength(1);
    expect(page2.offset).toBe(1);
  });

  it("emits structured rows plus the total/offset pagination cursor (R1)", async () => {
    seedAll();
    const result = await kh.callTool("search_meal_history", { recipe_uid: PASTA_UID });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as {
      items: Array<Record<string, unknown>>;
      total: number;
      offset: number;
    };
    expect(payload.total).toBe(2); // p-old + p-recent; p-future excluded
    expect(payload.offset).toBe(0);
    expect(payload.items.map((r) => r["uid"])).toEqual(["p-recent", "p-old"]); // newest-first
    expect(payload.items[0]).toMatchObject({ uid: "p-recent", recipeUid: PASTA_UID, typeName: "Dinner" });
  });

  it("over-paging past the end is an error with a remediation hint, not an empty success", async () => {
    seedAll();
    const result = await kh.callTool("search_meal_history", { recipe_uid: PASTA_UID, limit: 1, offset: 5 });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Try a lower offset");
  });

  it("reports an unknown class as an error", async () => {
    seedAll();
    const result = await kh.callTool("search_meal_history", { class: "Klingon" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('No category found matching "Klingon"');
  });

  it("reports an unknown meal type as an error", async () => {
    seedAll();
    const result = await kh.callTool("search_meal_history", { type: { name: "Brunch" } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Unknown meal type "Brunch"');
  });

  it("reports no matches for a recipe never cooked as an empty success", async () => {
    seedAll();
    const result = await kh.callTool("search_meal_history", { recipe_uid: "recipe-ghost" as RecipeUid });
    const json = getJson<{ items: unknown[]; total: number; offset: number }>(result);
    expect(json.items).toEqual([]);
    expect(json.total).toBe(0);
    // No match is a valid empty result, not an error.
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ items: [], total: 0, offset: 0 });
  });

  it("rejects unknown keys (strict schema)", () => {
    expect(searchMealHistoryInputSchema.safeParse({ recipe_uid: "x", bogus: 1 }).success).toBe(false);
  });
});
