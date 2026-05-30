import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { MealTypeStore } from "../cache/meal-type-store.js";
import { makeMealType } from "../cache/__fixtures__/meals.js";
import { registerMealTypesTool } from "./meal-types.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";

function makeMealTypeTestCtx(mealTypeStore: MealTypeStore) {
  const store = new RecipeStore();
  const { server, callTool } = makeTestServer();
  const ctx = makeCtx(store, server, { mealTypeStore });
  registerMealTypesTool(server, ctx);
  return { callTool };
}

describe("list_meal_types tool", () => {
  it("mealtypes.AC1.1: start guard blocks when mealTypeStore not synced", async () => {
    const mealTypeStore = new MealTypeStore();
    const { callTool } = makeMealTypeTestCtx(mealTypeStore);

    const result = await callTool("list_meal_types", {});
    const text = getText(result);
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("mealtypes.AC1.2: empty synced catalog returns a helpful message", async () => {
    const mealTypeStore = new MealTypeStore();
    mealTypeStore.load([]);
    const { callTool } = makeMealTypeTestCtx(mealTypeStore);

    const result = await callTool("list_meal_types", {});
    const text = getText(result);
    expect(text).toContain("No meal types found.");
  });

  it("mealtypes.AC1.3: meal types sorted by orderFlag ascending", async () => {
    const mealTypeStore = new MealTypeStore();
    mealTypeStore.load([
      makeMealType({ name: "Snacks", orderFlag: 3, originalType: 3 }),
      makeMealType({ name: "Breakfast", orderFlag: 0, originalType: 0 }),
      makeMealType({ name: "Brunch", orderFlag: 4, originalType: null }),
    ]);
    const { callTool } = makeMealTypeTestCtx(mealTypeStore);

    const result = await callTool("list_meal_types", {});
    const text = getText(result);
    expect(text.indexOf("Breakfast")).toBeLessThan(text.indexOf("Snacks"));
    expect(text.indexOf("Snacks")).toBeLessThan(text.indexOf("Brunch"));
  });

  it("mealtypes.AC1.4: meal types with same orderFlag sorted by name", async () => {
    const mealTypeStore = new MealTypeStore();
    mealTypeStore.load([
      makeMealType({ name: "Supper", orderFlag: 1, originalType: null }),
      makeMealType({ name: "Dessert", orderFlag: 1, originalType: null }),
    ]);
    const { callTool } = makeMealTypeTestCtx(mealTypeStore);

    const result = await callTool("list_meal_types", {});
    const text = getText(result);
    expect(text.indexOf("Dessert")).toBeLessThan(text.indexOf("Supper"));
  });

  it("mealtypes.AC1.5: marks built-in vs custom and renders schedule + UID", async () => {
    const mealTypeStore = new MealTypeStore();
    const dinner = makeMealType({
      name: "Dinner",
      orderFlag: 2,
      originalType: 2,
      exportAllDay: false,
      exportTime: 64800, // 18:00
    });
    const brunch = makeMealType({
      name: "Brunch",
      orderFlag: 4,
      originalType: null,
      exportAllDay: true,
      exportTime: 0,
    });
    mealTypeStore.load([dinner, brunch]);
    const { callTool } = makeMealTypeTestCtx(mealTypeStore);

    const result = await callTool("list_meal_types", {});
    const text = getText(result);
    expect(text).toContain("**Dinner** (built-in, 18:00)");
    expect(text).toContain(`\`${dinner.uid}\``);
    expect(text).toContain("**Brunch** (custom, all-day)");
    expect(text).toContain(`\`${brunch.uid}\``);
  });

  it("mealtypes.AC1.6: each meal type is on its own line with dash prefix", async () => {
    const mealTypeStore = new MealTypeStore();
    mealTypeStore.load([
      makeMealType({ name: "Breakfast", orderFlag: 0, originalType: 0 }),
      makeMealType({ name: "Lunch", orderFlag: 1, originalType: 1 }),
    ]);
    const { callTool } = makeMealTypeTestCtx(mealTypeStore);

    const result = await callTool("list_meal_types", {});
    const text = getText(result);
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- \*\*/);
    expect(lines[1]).toMatch(/^- \*\*/);
  });
});
