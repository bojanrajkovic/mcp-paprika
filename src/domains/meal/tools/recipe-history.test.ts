import { DateTime } from "luxon";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MealTypeUid } from "../../meal-type/ids.js";
import type { RecipeUid } from "../../recipe/ids.js";
import type { MealUid } from "../ids.js";
import type { Meal } from "../types.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMeal } from "../../../../test/domains/meal/__fixtures__/meals.js";
import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

const DINNER_UID = "dinner-uid" as MealTypeUid;
const LUNCH_UID = "lunch-uid" as MealTypeUid;
const CAKE_UID = "recipe-cake" as RecipeUid;
const SOUP_UID = "recipe-soup" as RecipeUid;

function wireDay(offset: number): string {
  return DateTime.utc().startOf("day").plus({ days: offset }).toFormat("yyyy-MM-dd HH:mm:ss");
}
function ymd(offset: number): string {
  return DateTime.utc().startOf("day").plus({ days: offset }).toFormat("yyyy-MM-dd");
}

describe("read_recipe_history tool", () => {
  const kh = useKernelHarness("meal");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  // One seed per test (load replaces): two recipes + two meal types + the given meals.
  function seed(meals: ReadonlyArray<Meal>): void {
    kh.seed({
      recipes: [makeRecipe({ uid: CAKE_UID, name: "Chocolate Cake" }), makeRecipe({ uid: SOUP_UID, name: "Soup" })],
      mealTypes: [
        makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 }),
        makeMealType({ uid: LUNCH_UID, name: "Lunch", originalType: 1, orderFlag: 1 }),
      ],
      meals,
    });
  }

  it("summarizes last cooked, count, and recent dates with meal types", async () => {
    seed([
      makeMeal({ recipeUid: CAKE_UID, name: "Cake", date: wireDay(-3), typeUid: DINNER_UID, type: 2 }),
      makeMeal({ recipeUid: CAKE_UID, name: "Cake", date: wireDay(-10), typeUid: DINNER_UID, type: 2 }),
      makeMeal({ recipeUid: CAKE_UID, name: "Cake", date: wireDay(-20), typeUid: LUNCH_UID, type: 1 }),
    ]);
    const text = await kh.callToolText("read_recipe_history", { recipe_uid: CAKE_UID });
    expect(text).toContain("**Chocolate Cake** — cooking history");
    expect(text).toContain(`Last cooked: ${ymd(-3)} · cooked 3 times`);
    expect(text).toContain(`- ${ymd(-3)} · Dinner`);
    expect(text).toContain(`- ${ymd(-20)} · Lunch`);
  });

  it("emits a structured summary with per-cook meal UIDs (R1)", async () => {
    seed([
      makeMeal({ uid: "cook-recent" as MealUid, recipeUid: CAKE_UID, date: wireDay(-3), typeUid: DINNER_UID, type: 2 }),
      makeMeal({ uid: "cook-old" as MealUid, recipeUid: CAKE_UID, date: wireDay(-20), typeUid: LUNCH_UID, type: 1 }),
    ]);
    const result = await kh.callTool("read_recipe_history", { recipe_uid: CAKE_UID });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as {
      recipeUid: string;
      recipeName: string;
      lastCooked: string | null;
      timesCooked: number;
      recent: Array<Record<string, unknown>>;
    };
    expect(payload).toMatchObject({
      recipeUid: CAKE_UID,
      recipeName: "Chocolate Cake",
      lastCooked: ymd(-3),
      timesCooked: 2,
    });
    // Each recent cook carries its own meal UID (named `uid`, like the list reads),
    // newest-first — so the model can reschedule/delete a specific past entry.
    expect(payload.recent).toEqual([
      { uid: "cook-recent", date: ymd(-3), typeName: "Dinner" },
      { uid: "cook-old", date: ymd(-20), typeName: "Lunch" },
    ]);
  });

  it("excludes future planner entries from the count and last-cooked", async () => {
    seed([
      makeMeal({ recipeUid: CAKE_UID, name: "Cake", date: wireDay(-2), typeUid: DINNER_UID, type: 2 }),
      makeMeal({ recipeUid: CAKE_UID, name: "Cake", date: wireDay(7), typeUid: DINNER_UID, type: 2 }),
    ]);
    const text = await kh.callToolText("read_recipe_history", { recipe_uid: CAKE_UID });
    expect(text).toContain(`Last cooked: ${ymd(-2)} · cooked 1 time`);
    expect(text).not.toContain(ymd(7));
  });

  it("reports no history for a future-only recipe as a zero-summary success", async () => {
    seed([makeMeal({ recipeUid: CAKE_UID, date: wireDay(5), typeUid: DINNER_UID, type: 2 })]);
    const result = await kh.callTool("read_recipe_history", { recipe_uid: CAKE_UID });
    expect(getText(result)).toContain("**Chocolate Cake** has no cooking history yet");
    // No history is a valid success — the zero-summary, not an error.
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      recipeUid: CAKE_UID,
      recipeName: "Chocolate Cake",
      lastCooked: null,
      timesCooked: 0,
      recent: [],
    });
  });

  it("reports no history when the recipe was never cooked", async () => {
    seed([makeMeal({ recipeUid: SOUP_UID, date: wireDay(-1), typeUid: DINNER_UID, type: 2 })]);
    const text = await kh.callToolText("read_recipe_history", { recipe_uid: CAKE_UID });
    expect(text).toContain("**Chocolate Cake** has no cooking history yet");
  });

  it("reports an unknown recipe UID as an error", async () => {
    seed([]);
    const result = await kh.callTool("read_recipe_history", { recipe_uid: "recipe-missing" as RecipeUid });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('No recipe found with UID "recipe-missing"');
  });

  it("excludes prep-work (isIngredient) entries", async () => {
    seed([
      makeMeal({ recipeUid: CAKE_UID, date: wireDay(-2), typeUid: DINNER_UID, type: 2 }),
      makeMeal({ recipeUid: CAKE_UID, date: wireDay(-1), typeUid: DINNER_UID, type: 2, isIngredient: true }),
    ]);
    const text = await kh.callToolText("read_recipe_history", { recipe_uid: CAKE_UID });
    expect(text).toContain(`Last cooked: ${ymd(-2)} · cooked 1 time`);
    expect(text).not.toContain(ymd(-1));
  });

  it("resolves legacy meals (typeUid: null) by integer type", async () => {
    seed([makeMeal({ recipeUid: CAKE_UID, date: wireDay(-2), typeUid: null, type: 2 })]);
    const text = await kh.callToolText("read_recipe_history", { recipe_uid: CAKE_UID });
    expect(text).toContain(`- ${ymd(-2)} · Dinner`);
  });

  it("truncates the recent list at 10 with a count note", async () => {
    const meals = Array.from({ length: 12 }, (_, i) =>
      makeMeal({ recipeUid: CAKE_UID, date: wireDay(-(i + 1)), typeUid: DINNER_UID, type: 2 }),
    );
    seed(meals);
    const text = await kh.callToolText("read_recipe_history", { recipe_uid: CAKE_UID });
    expect(text).toContain("cooked 12 times");
    expect(text).toContain("_Showing 10 most recent of 12._");
    const bulletCount = text.split("\n").filter((l) => l.startsWith("- ")).length;
    expect(bulletCount).toBe(10);
  });

  it("guards when meal data is not synced (isError, so it is exempt from output validation)", async () => {
    kh.seed({ recipes: [makeRecipe({ uid: CAKE_UID, name: "Chocolate Cake" })] });
    const result = await kh.callTool("read_recipe_history", { recipe_uid: CAKE_UID });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("not yet synced");
  });
});
