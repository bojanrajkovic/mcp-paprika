import { describe, expect, it } from "vitest";

import { makeMeal } from "../../../test/cache/__fixtures__/meals.js";
import { mealToMarkdown } from "./meal-helpers.js";

// ---------------------------------------------------------------------------
// mealToMarkdown renderer
// ---------------------------------------------------------------------------

describe("mealToMarkdown renderer", () => {
  it("freeform meal (recipeUid: null) renders _(freeform)_ and no scale line", () => {
    const meal = makeMeal({ name: "My Meal", recipeUid: null, scale: null });
    const result = mealToMarkdown(meal, "Dinner", null);
    expect(result).toContain("# My Meal");
    expect(result).toContain("**Recipe:** _(freeform)_");
    expect(result).not.toContain("**Scale:**");
    expect(result).not.toContain("**Recipe:** null");
  });

  it("recipe-linked meal renders name and UID", () => {
    const meal = makeMeal({ name: "Taco Night", recipeUid: "recipe-uid-abc", scale: null });
    const result = mealToMarkdown(meal, "Dinner", "Tacos");
    expect(result).toContain("**Recipe:** Tacos (`recipe-uid-abc`)");
    expect(result).not.toContain("_(freeform)_");
  });

  it("meal with non-null non-empty scale renders scale line", () => {
    const meal = makeMeal({ name: "Scaled", recipeUid: null, scale: "2x" });
    const result = mealToMarkdown(meal, "Lunch", null);
    expect(result).toContain("**Scale:** 2x");
  });

  it("meal with scale: null omits scale line", () => {
    const meal = makeMeal({ name: "No Scale", recipeUid: null, scale: null });
    const result = mealToMarkdown(meal, "Breakfast", null);
    expect(result).not.toContain("**Scale:**");
  });

  it("meal with scale: '' omits scale line", () => {
    const meal = makeMeal({ name: "Empty Scale", recipeUid: null, scale: "" });
    const result = mealToMarkdown(meal, "Snacks", null);
    expect(result).not.toContain("**Scale:**");
  });

  it("includes UID, date, and type fields", () => {
    const meal = makeMeal({ name: "Complete", date: "2026-03-15 12:00:00", recipeUid: null, scale: null });
    const result = mealToMarkdown(meal, "Dinner", null);
    expect(result).toContain(`**UID:** \`${meal.uid}\``);
    expect(result).toContain("**Date:** 2026-03-15 12:00:00");
    expect(result).toContain("**Type:** Dinner");
  });
});
