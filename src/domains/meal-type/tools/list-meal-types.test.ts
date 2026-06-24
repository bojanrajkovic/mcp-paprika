import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MealTypeUid } from "../ids.js";

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

  it("empty synced catalog returns an empty items array", async () => {
    kh.seed({ mealTypes: [] });
    const { items } = await kh.callToolJson<{ items: Array<unknown> }>("list_meal_types", {});
    expect(items).toEqual([]);
  });

  it("emits structured rows with uid, name, and originalType (R1)", async () => {
    kh.seed({
      mealTypes: [
        makeMealType({ uid: "mt-dinner" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 }),
        makeMealType({ uid: "mt-brunch" as MealTypeUid, name: "Brunch", orderFlag: 4, originalType: null }),
      ],
    });
    const result = await kh.callTool("list_meal_types", {});
    expect(result.isError).toBeFalsy();
    const { items } = result.structuredContent as { items: Array<Record<string, unknown>> };
    // Sorted by orderFlag (Dinner 2 before Brunch 4); originalType is the built-in
    // index (null for the custom type).
    expect(items).toEqual([
      { uid: "mt-dinner", name: "Dinner", originalType: 2 },
      { uid: "mt-brunch", name: "Brunch", originalType: null },
    ]);
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

  it("distinguishes built-in vs custom via originalType and carries each UID", async () => {
    // The export schedule (clock time / all-day) was display-only Markdown and is not in
    // the structured row, so it is no longer surfaced; built-in vs custom rides originalType.
    const dinner = makeMealType({ name: "Dinner", orderFlag: 2, originalType: 2 });
    const brunch = makeMealType({ name: "Brunch", orderFlag: 4, originalType: null });
    kh.seed({ mealTypes: [dinner, brunch] });
    const { items } = await kh.callToolJson<{
      items: Array<{ uid: string; name: string; originalType: number | null }>;
    }>("list_meal_types", {});
    expect(items).toContainEqual({ uid: dinner.uid, name: "Dinner", originalType: 2 });
    expect(items).toContainEqual({ uid: brunch.uid, name: "Brunch", originalType: null });
  });

  it("returns one row per meal type", async () => {
    kh.seed({
      mealTypes: [
        makeMealType({ name: "Breakfast", orderFlag: 0, originalType: 0 }),
        makeMealType({ name: "Lunch", orderFlag: 1, originalType: 1 }),
      ],
    });
    const { items } = await kh.callToolJson<{ items: Array<unknown> }>("list_meal_types", {});
    expect(items).toHaveLength(2);
  });
});
