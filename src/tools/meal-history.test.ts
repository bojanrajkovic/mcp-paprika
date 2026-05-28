import { describe, it, expect, beforeEach } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { MealStore } from "../cache/meal-store.js";
import { MealTypeStore } from "../cache/meal-type-store.js";
import { makeMeal, makeMealType } from "../cache/__fixtures__/meals.js";
import { registerMealHistoryTool } from "./meal-history.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { MealTypeUid } from "../paprika/types.js";

describe("list_meal_history tool", () => {
  let store: RecipeStore;
  let mealStore: MealStore;
  let mealTypeStore: MealTypeStore;
  let callTool: ReturnType<typeof makeTestServer>["callTool"];

  beforeEach(() => {
    store = new RecipeStore();
    store.markSynced();

    mealStore = new MealStore();
    mealTypeStore = new MealTypeStore();

    mealTypeStore.load([
      makeMealType({ uid: "breakfast-uid" as MealTypeUid, name: "Breakfast", originalType: 0, orderFlag: 0 }),
      makeMealType({ uid: "lunch-uid" as MealTypeUid, name: "Lunch", originalType: 1, orderFlag: 1 }),
      makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", originalType: 2, orderFlag: 2 }),
    ]);

    const { server, callTool: ct } = makeTestServer();
    callTool = ct;
    const ctx = makeCtx(store, server, { mealStore, mealTypeStore });
    registerMealHistoryTool(server, ctx);
  });

  it("returns cold-start guard when not synced", async () => {
    const result = await callTool("list_meal_history", {});
    expect(getText(result)).toContain("not yet synced");
  });

  it("returns no meals message when empty", async () => {
    mealStore.load([]);
    const result = await callTool("list_meal_history", {
      since: "2026-01-01",
      until: "2026-12-31",
    });
    expect(getText(result)).toContain("No meals found");
  });

  it("renders calendar-style grouped output", async () => {
    mealStore.load([
      makeMeal({
        recipeUid: "recipe-1",
        name: "Chicken Soup",
        date: "2026-05-20 00:00:00",
        type: 2,
        typeUid: "dinner-uid",
      }),
      makeMeal({
        recipeUid: null,
        name: "Leftovers",
        date: "2026-05-20 00:00:00",
        type: 1,
        typeUid: "lunch-uid",
      }),
    ]);

    const result = await callTool("list_meal_history", {
      since: "2026-05-19",
      until: "2026-05-21",
    });
    const text = getText(result);
    expect(text).toContain("Showing 2 meals");
    expect(text).toContain("### Wed 20");
    expect(text).toContain("**Lunch** · Leftovers *(freeform)*");
    expect(text).toContain("**Dinner** · Chicken Soup");
  });

  it("filters by recipe_uid across all time", async () => {
    mealStore.load([
      makeMeal({ recipeUid: "recipe-1", name: "Chicken", date: "2020-01-01 00:00:00" }),
      makeMeal({ recipeUid: "recipe-2", name: "Pasta", date: "2026-05-20 00:00:00" }),
    ]);

    const result = await callTool("list_meal_history", { recipe_uid: "recipe-1" });
    const text = getText(result);
    expect(text).toContain("Chicken");
    expect(text).not.toContain("Pasta");
  });

  it("filters by type name", async () => {
    mealStore.load([
      makeMeal({ name: "Eggs", date: "2026-05-20 00:00:00", type: 0, typeUid: "breakfast-uid" }),
      makeMeal({ name: "Steak", date: "2026-05-20 00:00:00", type: 2, typeUid: "dinner-uid" }),
    ]);

    const result = await callTool("list_meal_history", { type: { name: "Breakfast" } });
    const text = getText(result);
    expect(text).toContain("Eggs");
    expect(text).not.toContain("Steak");
  });

  it("returns error for unknown type name", async () => {
    mealStore.load([]);
    const result = await callTool("list_meal_history", { type: { name: "Brunch" } });
    expect(getText(result)).toContain("Unknown meal type");
  });

  it("filters by uid directly", async () => {
    mealStore.load([
      makeMeal({ name: "Eggs", date: "2026-05-20 00:00:00", type: 0, typeUid: "breakfast-uid" }),
      makeMeal({ name: "Steak", date: "2026-05-20 00:00:00", type: 2, typeUid: "dinner-uid" }),
    ]);

    const result = await callTool("list_meal_history", { type: { uid: "dinner-uid" } });
    const text = getText(result);
    expect(text).toContain("Steak");
    expect(text).not.toContain("Eggs");
  });

  it("resolves type by builtin integer", async () => {
    mealStore.load([
      makeMeal({ name: "Eggs", date: "2026-05-20 00:00:00", type: 0, typeUid: "breakfast-uid" }),
      makeMeal({ name: "Steak", date: "2026-05-20 00:00:00", type: 2, typeUid: "dinner-uid" }),
    ]);

    const result = await callTool("list_meal_history", { type: { builtin: 0 } });
    const text = getText(result);
    expect(text).toContain("Eggs");
    expect(text).not.toContain("Steak");
  });

  it("annotates freeform meals", async () => {
    mealStore.load([
      makeMeal({ recipeUid: null, name: "Quick sandwich", date: "2026-05-20 00:00:00" }),
      makeMeal({ recipeUid: "recipe-1", name: "Chicken Soup", date: "2026-05-20 00:00:00" }),
    ]);

    const result = await callTool("list_meal_history", {
      since: "2026-05-19",
      until: "2026-05-21",
    });
    const text = getText(result);
    expect(text).toContain("Quick sandwich *(freeform)*");
    expect(text).not.toContain("Chicken Soup *(freeform)*");
  });

  it("shows pagination header when total exceeds limit", async () => {
    const meals = Array.from({ length: 5 }, (_, i) =>
      makeMeal({
        name: `Meal ${String(i)}`,
        date: `2026-05-${String(20 + i).padStart(2, "0")} 00:00:00`,
      }),
    );
    mealStore.load(meals);

    const result = await callTool("list_meal_history", {
      since: "2026-05-19",
      until: "2026-05-30",
      limit: 2,
    });
    const text = getText(result);
    expect(text).toContain("1–2 of 5");
  });

  it("parses since/until date errors", async () => {
    mealStore.load([]);

    const result = await callTool("list_meal_history", { since: "not-a-date" });
    expect(getText(result)).toContain("Could not parse since date");
  });
});
