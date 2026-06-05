import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("list_meal_types tool", () => {
  const kh = useKernelHarness("meal-type");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("start guard blocks when mealTypeStore not synced", async () => {
    // mealTypes key omitted → mealTypeStore stays cold (hasSynced === false)
    const text = await kh.callToolText("list_meal_types", {});
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("empty synced catalog returns a helpful message", async () => {
    kh.seed({ mealTypes: [] });
    const text = await kh.callToolText("list_meal_types", {});
    expect(text).toContain("No meal types found.");
  });

  it("meal types sorted by orderFlag ascending", async () => {
    kh.seed({
      mealTypes: [
        makeMealType({ name: "Snacks", orderFlag: 3, originalType: 3 }),
        makeMealType({ name: "Breakfast", orderFlag: 0, originalType: 0 }),
        makeMealType({ name: "Brunch", orderFlag: 4, originalType: null }),
      ],
    });
    const text = await kh.callToolText("list_meal_types", {});
    expect(text.indexOf("Breakfast")).toBeLessThan(text.indexOf("Snacks"));
    expect(text.indexOf("Snacks")).toBeLessThan(text.indexOf("Brunch"));
  });

  it("meal types with same orderFlag sorted by name", async () => {
    kh.seed({
      mealTypes: [
        makeMealType({ name: "Supper", orderFlag: 1, originalType: null }),
        makeMealType({ name: "Dessert", orderFlag: 1, originalType: null }),
      ],
    });
    const text = await kh.callToolText("list_meal_types", {});
    expect(text.indexOf("Dessert")).toBeLessThan(text.indexOf("Supper"));
  });

  it("marks built-in vs custom and renders schedule and UID", async () => {
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
    kh.seed({ mealTypes: [dinner, brunch] });
    const text = await kh.callToolText("list_meal_types", {});
    expect(text).toContain("**Dinner** (built-in, 18:00)");
    expect(text).toContain(`\`${dinner.uid}\``);
    expect(text).toContain("**Brunch** (custom, all-day)");
    expect(text).toContain(`\`${brunch.uid}\``);
  });

  it("each meal type is on its own line with dash prefix", async () => {
    kh.seed({
      mealTypes: [
        makeMealType({ name: "Breakfast", orderFlag: 0, originalType: 0 }),
        makeMealType({ name: "Lunch", orderFlag: 1, originalType: 1 }),
      ],
    });
    const text = await kh.callToolText("list_meal_types", {});
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- \*\*/);
    expect(lines[1]).toMatch(/^- \*\*/);
  });
});
