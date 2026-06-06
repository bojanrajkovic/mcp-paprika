import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeState } from "../module.js";
import type { MealType } from "../types.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("update_meal_type tool", () => {
  const kh = useKernelHarness<MealTypeState>("meal-type");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  function seedCatalog(): { breakfast: MealType; dinner: MealType; brunch: MealType } {
    const breakfast = makeMealType({ name: "Breakfast", orderFlag: 0, originalType: 0 });
    const dinner = makeMealType({ name: "Dinner", orderFlag: 1, originalType: 2 });
    const brunch = makeMealType({ name: "Brunch", orderFlag: 2, originalType: null, color: "#000000" });
    kh.seed({ mealTypes: [breakfast, dinner, brunch] });
    return { breakfast, dinner, brunch };
  }

  it("returns sync-not-ready message when the catalog has not synced", async () => {
    const text = await kh.callToolText("update_meal_type", { uid: "mt-x", name: "Supper" });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns not-found for an unknown UID", async () => {
    seedCatalog();
    const text = await kh.callToolText("update_meal_type", { uid: "nope", name: "Supper" });
    expect(text).toContain('No meal type found with UID "nope"');
  });

  it("requires at least one editable field", async () => {
    const { brunch } = seedCatalog();
    const text = await kh.callToolText("update_meal_type", { uid: brunch.uid });
    expect(text).toContain("Nothing to update");
  });

  it("renames and recolors in one call, preserving originalType", async () => {
    const { dinner } = seedCatalog();

    const text = await kh.callToolText("update_meal_type", { uid: dinner.uid, name: "Supper", color: "#4A90D9" });

    expect(text).toContain('renamed to "Supper"');
    expect(text).toContain("recolored to #4A90D9");
    const updated = kh.state().store.get(dinner.uid);
    expect(updated).toMatchObject({ name: "Supper", color: "#4A90D9", originalType: 2, orderFlag: 1 });
    const saveMealTypes = vi.mocked(kh.client().saveMealTypes);
    expect(saveMealTypes).toHaveBeenCalledOnce();
    const saved = saveMealTypes.mock.calls[0]![0] as ReadonlyArray<MealType>;
    expect(saved).toHaveLength(1);
    // Menu resources render meal-type names from this catalog live, so the
    // commit must tell subscribed clients to refresh.
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("rejects a rename that collides with another type's name", async () => {
    const { brunch } = seedCatalog();
    const text = await kh.callToolText("update_meal_type", { uid: brunch.uid, name: "dinner" });
    expect(text).toContain('A meal type named "Dinner" already exists');
    expect(kh.client().saveMealTypes).not.toHaveBeenCalled();
  });

  it("moves a type to a new position and renumbers contiguously", async () => {
    const { breakfast, dinner, brunch } = seedCatalog();

    const text = await kh.callToolText("update_meal_type", { uid: brunch.uid, position: 1 });

    expect(text).toContain("moved to position 1");
    expect(kh.state().store.get(brunch.uid)?.orderFlag).toBe(0);
    expect(kh.state().store.get(breakfast.uid)?.orderFlag).toBe(1);
    expect(kh.state().store.get(dinner.uid)?.orderFlag).toBe(2);
  });

  it("reports no changes when nothing differs", async () => {
    const { brunch } = seedCatalog();
    const text = await kh.callToolText("update_meal_type", { uid: brunch.uid, name: "Brunch", color: "#000000" });
    expect(text).toContain("No changes");
    expect(kh.client().saveMealTypes).not.toHaveBeenCalled();
  });
});
