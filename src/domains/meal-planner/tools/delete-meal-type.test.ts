import { errAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeState } from "../../meal-type/module.js";
import type { MealType } from "../../meal-type/types.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMeal } from "../../../../test/domains/meal/__fixtures__/meals.js";
import { makeMenu, makeMenuItem } from "../../../../test/domains/menu/__fixtures__/menus.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("delete_meal_type tool", () => {
  const kh = useKernelHarness("meal-planner");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  const mealTypeState = (): MealTypeState => kh.stateOf("meal-type") as MealTypeState;

  function seedBase(
    mealType: MealType,
    extra?: { meals?: Parameters<typeof kh.seed>[0]["meals"]; menuItems?: Parameters<typeof kh.seed>[0]["menuItems"] },
  ): void {
    kh.seed({
      recipes: [],
      mealTypes: [mealType],
      meals: extra?.meals ?? [],
      menus: [makeMenu()],
      menuItems: extra?.menuItems ?? [],
    });
  }

  it("returns sync-not-ready before the catalogs are warm", async () => {
    const text = await kh.callToolText("delete_meal_type", { uid: "mt-x" });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns not-found for an unknown UID", async () => {
    seedBase(makeMealType({ name: "Brunch" }));
    const text = await kh.callToolText("delete_meal_type", { uid: "nope" });
    expect(text).toContain('No meal type found with UID "nope"');
  });

  it("deletes an unreferenced type with no impact note", async () => {
    const brunch = makeMealType({ name: "Brunch", originalType: null });
    seedBase(brunch);

    const text = await kh.callToolText("delete_meal_type", { uid: brunch.uid });

    expect(text).toBe('Deleted meal type "Brunch".');
    expect(kh.resourceListChanged()).toHaveBeenCalled();
    const saveMealTypes = vi.mocked(kh.client().saveMealTypes);
    expect(saveMealTypes).toHaveBeenCalledOnce();
    const saved = saveMealTypes.mock.calls[0]![0] as ReadonlyArray<MealType>;
    expect(saved[0]).toMatchObject({ uid: brunch.uid, deleted: true });
    expect(mealTypeState().store.get(brunch.uid)).toBeUndefined();
  });

  it("declining the confirm cancels without writing", async () => {
    const brunch = makeMealType({ name: "Brunch", originalType: null });
    seedBase(brunch);
    kh.setElicitResponder(() => ({ action: "decline" }));

    const text = await kh.callToolText("delete_meal_type", { uid: brunch.uid });

    expect(text).toContain("Cancelled");
    expect(kh.client().saveMealTypes).not.toHaveBeenCalled();
  });

  it("warns-and-proceeds over meal and menu-item references on a custom type", async () => {
    const brunch = makeMealType({ name: "Brunch", originalType: null });
    const menu = makeMenu();
    seedBase(brunch, {
      meals: [makeMeal({ typeUid: brunch.uid }), makeMeal({ typeUid: brunch.uid })],
      menuItems: [makeMenuItem({ menuUid: menu.uid, typeUid: brunch.uid })],
    });

    const text = await kh.callToolText("delete_meal_type", { uid: brunch.uid });

    expect(text).toContain('Deleted meal type "Brunch".');
    expect(text).toContain("2 meals and 1 menu item referenced it");
    expect(mealTypeState().store.get(brunch.uid)).toBeUndefined();
  });

  it("refuses to delete a built-in type — {builtin} resolution cannot be restored", async () => {
    const dinner = makeMealType({ name: "Dinner", originalType: 2 });
    seedBase(dinner);

    const text = await kh.callToolText("delete_meal_type", { uid: dinner.uid });

    expect(text).toContain('Cannot delete "Dinner"');
    expect(text).toContain("built-in");
    expect(kh.client().saveMealTypes).not.toHaveBeenCalled();
    expect(mealTypeState().store.get(dinner.uid)).toBeDefined();
  });

  it("surfaces a save failure and keeps the type", async () => {
    const brunch = makeMealType({ name: "Brunch", originalType: null });
    seedBase(brunch);
    vi.mocked(kh.client().saveMealTypes).mockReturnValue(
      errAsync({ kind: "http", status: 500, message: "boom" } as never),
    );

    const text = await kh.callToolText("delete_meal_type", { uid: brunch.uid });

    expect(text).toContain('Failed to delete meal type "Brunch"');
    expect(mealTypeState().store.get(brunch.uid)).toBeDefined();
  });
});
