import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeUid } from "../../meal-type/ids.js";
import type { MealState } from "../../meal/module.js";
import type { Meal } from "../../meal/types.js";
import type { MenuUid } from "../../menu/ids.js";
import type { MenuItem } from "../../menu/menu-item/types.js";
import type { Menu } from "../../menu/types.js";
import type { RecipeUid } from "../../recipe/ids.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMeal } from "../../../../test/domains/meal/__fixtures__/meals.js";
import { makeMenu, makeMenuItem } from "../../../../test/domains/menu/__fixtures__/menus.js";
import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

const BREAKFAST_UID = "breakfast-uid" as MealTypeUid;
const LUNCH_UID = "lunch-uid" as MealTypeUid;
const DINNER_UID = "dinner-uid" as MealTypeUid;
const SNACKS_UID = "snacks-uid" as MealTypeUid;

const BUTTER_CHICKEN_UID = "recipe-butter-chicken" as RecipeUid;
const HONEY_MUSTARD_UID = "recipe-honey-mustard" as RecipeUid;
const MENU_UID = "menu-multiday" as MenuUid;

function makeBuiltins() {
  return [
    makeMealType({ uid: BREAKFAST_UID, name: "Breakfast", originalType: 0, orderFlag: 0 }),
    makeMealType({ uid: LUNCH_UID, name: "Lunch", originalType: 1, orderFlag: 1 }),
    makeMealType({ uid: DINNER_UID, name: "Dinner", originalType: 2, orderFlag: 2 }),
    makeMealType({ uid: SNACKS_UID, name: "Snacks", originalType: 3, orderFlag: 3 }),
  ];
}

/** Two Dinner items on day 1 and day 3 — the exact shape of the wire capture. */
function multiDayMenuSeed(): { menus: Menu[]; menuItems: MenuItem[] } {
  return {
    menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 3 })],
    menuItems: [
      makeMenuItem({
        uid: "mi-day1" as MenuItem["uid"],
        menuUid: MENU_UID,
        recipeUid: BUTTER_CHICKEN_UID,
        name: "(Not) Butter Chicken",
        day: 1,
        typeUid: DINNER_UID,
        orderFlag: 0,
      }),
      makeMenuItem({
        uid: "mi-day3" as MenuItem["uid"],
        menuUid: MENU_UID,
        recipeUid: HONEY_MUSTARD_UID,
        name: "20 Minute Honey Mustard Chicken",
        day: 3,
        typeUid: DINNER_UID,
        orderFlag: 1,
      }),
    ],
  };
}

describe("schedule_menu — guards", () => {
  const kh = useKernelHarness("meal-planner");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("recipe store cold → recipe-sync message", async () => {
    // seed menu, meal-type, meal but NOT recipes
    kh.seed({
      menus: [],
      menuItems: [],
      mealTypes: makeBuiltins(),
      meals: [],
    });
    const text = await kh.callToolText("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    expect(text).toContain("Recipe store is not yet synced");
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("menu store cold → menu-sync message", async () => {
    // seed recipes and meal-type and meal but NOT menus/menuItems
    kh.seed({
      recipes: [
        makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
        makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
      ],
      mealTypes: makeBuiltins(),
      meals: [],
    });
    const text = await kh.callToolText("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    expect(text).toContain("Menu data is not yet synced");
  });

  it("meal-type store cold → menu-sync message (menuStartGuard gates mealTypeStore)", async () => {
    // seed recipes and menu/menuItems and meal but NOT meal-types
    kh.seed({
      recipes: [
        makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
        makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
      ],
      menus: [],
      menuItems: [],
      meals: [],
    });
    const text = await kh.callToolText("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    expect(text).toContain("Menu data is not yet synced");
  });

  it("meal store cold → planner-sync message", async () => {
    // seed recipes, menus, meal-types but NOT meals
    kh.seed({
      recipes: [
        makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
        makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
      ],
      menus: [],
      menuItems: [],
      mealTypes: makeBuiltins(),
    });
    const text = await kh.callToolText("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    expect(text).toContain("Meal planner is not yet synced");
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });
});

describe("schedule_menu — menu resolution", () => {
  const kh = useKernelHarness("meal-planner");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  function seedAll(opts: { menus?: Menu[]; menuItems?: MenuItem[] } = {}) {
    kh.seed({
      recipes: [
        makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
        makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
      ],
      menus: opts.menus ?? [],
      menuItems: opts.menuItems ?? [],
      mealTypes: makeBuiltins(),
      meals: [],
    });
  }

  it("uid_miss → no menu found", async () => {
    seedAll();
    const result = await kh.callTool("schedule_menu", { menu: { uid: "nope" as MenuUid }, start_date: "2026-05-27" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(
      'No menu found with UID "nope" (it may not exist or was already deleted). Use list_menus to find it.',
    );
  });

  it("text_none → no menus matching", async () => {
    seedAll();
    const result = await kh.callTool("schedule_menu", { menu: { name: "Ghost Menu" }, start_date: "2026-05-27" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('No menus found matching "Ghost Menu". Use list_menus to find it.');
  });

  it("text_many → disambiguation list", async () => {
    seedAll({
      menus: [
        makeMenu({ uid: "m-a" as MenuUid, name: "Week Plan A" }),
        makeMenu({ uid: "m-b" as MenuUid, name: "Week Plan B" }),
      ],
    });
    // "Week Plan" is a contains-match for both.
    const result = await kh.callTool("schedule_menu", { menu: { name: "Week Plan" }, start_date: "2026-05-27" });
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('Multiple menus match "Week Plan"');
    expect(text).toContain("`m-a`");
    expect(text).toContain("`m-b`");
  });

  it("empty menu → informational message, no POST", async () => {
    seedAll({
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 3 })],
      menuItems: [],
    });
    const result = await kh.callTool("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    expect(getText(result)).toBe('Menu "Multi-Day" has no items to add to the planner.');
    // Nothing was created → a not-a-result branch under the declared outputSchema.
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });
});

describe("schedule_menu — materialization", () => {
  const kh = useKernelHarness("meal-planner");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("wire-capture scenario: day-1 and day-3 Dinners → start and start+2, both order_flag 0", async () => {
    kh.seed({
      recipes: [
        makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
        makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
      ],
      ...multiDayMenuSeed(),
      mealTypes: makeBuiltins(),
      meals: [],
    });

    // saveMeals must return the items it receives (identity mock) so commitMealsBatch can proceed
    vi.mocked(kh.client().saveMeals).mockImplementation((items: ReadonlyArray<Meal>) => okAsync(items));

    const result = await kh.callTool("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<Meal>;

    expect(payload).toHaveLength(2);
    const day1 = payload.find((m) => m.date === "2026-05-27 00:00:00");
    const day3 = payload.find((m) => m.date === "2026-05-29 00:00:00");
    expect(day1).toBeDefined();
    expect(day3).toBeDefined();
    // Both Dinner, different dates → each is the first on its own date → both 0.
    expect(day1!.orderFlag).toBe(0);
    expect(day3!.orderFlag).toBe(0);
    expect(day1!.typeUid).toBe(DINNER_UID);
    expect(day1!.type).toBe(2);
    expect(day1!.recipeUid).toBe(BUTTER_CHICKEN_UID);
    // Posted meals carry NO menu back-reference — it's a copy, not a link.
    expect(day1).not.toHaveProperty("menuUid");
    expect(day1).not.toHaveProperty("menu_uid");

    // Compact day-grouped response with no per-meal UIDs.
    const text = getText(result);
    expect(text).toContain('Added 2 meal(s) to the planner from "Multi-Day" (Day 1 = 2026-05-27).');
    expect(text).toContain("## 2026-05-27 (Day 1)");
    expect(text).toContain("## 2026-05-29 (Day 3)");
    expect(text).toContain("- **Dinner:** (Not) Butter Chicken");
    expect(text).not.toMatch(/`[0-9A-F-]{36}`/); // no meal UIDs in the text

    // The new meal UIDs ride structuredContent — the text omits them entirely, so this
    // is the only channel the model can chain reschedule_meal / delete_meal on.
    const structured = result.structuredContent as {
      items: ReadonlyArray<{ uid: string; recipeUid: string | null; typeName: string | null }>;
    };
    expect(structured.items).toHaveLength(2);
    expect(structured.items.map((i) => i.uid).sort()).toEqual(payload.map((m) => m.uid).sort());
    expect(structured.items.every((i) => i.typeName === "Dinner")).toBe(true);
  });

  it("two items on the SAME day → flags 0 and 1 (per-date sequence within the batch)", async () => {
    kh.seed({
      recipes: [
        makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
        makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
      ],
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      menuItems: [
        makeMenuItem({
          uid: "mi-1" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: BUTTER_CHICKEN_UID,
          day: 1,
          typeUid: DINNER_UID,
        }),
        makeMenuItem({
          uid: "mi-2" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: HONEY_MUSTARD_UID,
          day: 1,
          typeUid: LUNCH_UID,
        }),
      ],
      mealTypes: makeBuiltins(),
      meals: [],
    });

    vi.mocked(kh.client().saveMeals).mockImplementation((items: ReadonlyArray<Meal>) => okAsync(items));

    await kh.callTool("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<Meal>;

    expect(payload).toHaveLength(2);
    expect(payload.map((m) => m.orderFlag).sort((a, b) => a - b)).toEqual([0, 1]);
    expect(payload.every((m) => m.date === "2026-05-27 00:00:00")).toBe(true);
  });

  it("same-day flags follow MENU LAYOUT order (meal-type order), not store insertion order", async () => {
    // The menu lists Dinner before Lunch (store-insertion order), but order_flag
    // must sequence by meal-type order within the date — Lunch (typeorder 1) gets
    // flag 0, Dinner (typeorder 2) gets flag 1 — matching the wire capture.
    kh.seed({
      recipes: [
        makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
        makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
      ],
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      menuItems: [
        makeMenuItem({
          uid: "mi-dinner" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: BUTTER_CHICKEN_UID,
          day: 1,
          typeUid: DINNER_UID,
          orderFlag: 0,
        }),
        makeMenuItem({
          uid: "mi-lunch" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: HONEY_MUSTARD_UID,
          day: 1,
          typeUid: LUNCH_UID,
          orderFlag: 1,
        }),
      ],
      mealTypes: makeBuiltins(),
      meals: [],
    });

    vi.mocked(kh.client().saveMeals).mockImplementation((items: ReadonlyArray<Meal>) => okAsync(items));

    await kh.callTool("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<Meal>;

    const lunch = payload.find((m) => m.typeUid === LUNCH_UID);
    const dinner = payload.find((m) => m.typeUid === DINNER_UID);
    expect(lunch?.orderFlag).toBe(0);
    expect(dinner?.orderFlag).toBe(1);
    // POST order follows layout too: Lunch before Dinner.
    expect(payload[0]?.typeUid).toBe(LUNCH_UID);
  });

  it("pre-existing planner meal on the date → new flag seeds from getMaxOrderFlagOn + 1", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" })],
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      menuItems: [
        makeMenuItem({
          uid: "mi-1" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: BUTTER_CHICKEN_UID,
          day: 1,
          typeUid: DINNER_UID,
        }),
      ],
      mealTypes: makeBuiltins(),
      meals: [makeMeal({ date: "2026-05-27 00:00:00", typeUid: BREAKFAST_UID, orderFlag: 3 })],
    });

    vi.mocked(kh.client().saveMeals).mockImplementation((items: ReadonlyArray<Meal>) => okAsync(items));

    await kh.callTool("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    // Existing max on the date is 3 (a Breakfast); the new Dinner seeds at 4 — per
    // date, not per type.
    expect(payload[0]?.orderFlag).toBe(4);
  });

  it("freeform menu item (recipeUid: null) → materialized from its stored name", async () => {
    kh.seed({
      recipes: [],
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      menuItems: [
        makeMenuItem({
          uid: "mi-free" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: null,
          name: "Leftovers Night",
          day: 1,
          typeUid: DINNER_UID,
        }),
      ],
      mealTypes: makeBuiltins(),
      meals: [],
    });

    vi.mocked(kh.client().saveMeals).mockImplementation((items: ReadonlyArray<Meal>) => okAsync(items));

    const result = await kh.callTool("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    expect(payload[0]?.recipeUid).toBeNull();
    expect(payload[0]?.name).toBe("Leftovers Night");
    expect(getText(result)).toContain("- **Dinner:** Leftovers Night");
  });

  it("unknown/custom typeUid → type integer falls back to 0, typeUid preserved", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" })],
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      menuItems: [
        makeMenuItem({
          uid: "mi-custom" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: BUTTER_CHICKEN_UID,
          day: 1,
          typeUid: "custom-unsynced-type",
        }),
      ],
      mealTypes: makeBuiltins(),
      meals: [],
    });

    vi.mocked(kh.client().saveMeals).mockImplementation((items: ReadonlyArray<Meal>) => okAsync(items));

    const result = await kh.callTool("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = vi.mocked(kh.client().saveMeals).mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    expect(payload[0]?.typeUid).toBe("custom-unsynced-type");
    expect(payload[0]?.type).toBe(0);
    // Type name falls back to the raw uid in the response when it can't be resolved.
    expect(getText(result)).toContain("- **custom-unsynced-type:**");
  });
});

describe("schedule_menu — rejection paths", () => {
  const kh = useKernelHarness("meal-planner");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("unknown recipe → whole batch rejected, zero POST", async () => {
    kh.seed({
      recipes: [makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" })],
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 3 })],
      menuItems: [
        makeMenuItem({
          uid: "mi-ok" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: BUTTER_CHICKEN_UID,
          day: 1,
          typeUid: DINNER_UID,
        }),
        makeMenuItem({
          uid: "mi-bad" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: "recipe-ghost",
          day: 2,
          typeUid: DINNER_UID,
        }),
      ],
      mealTypes: makeBuiltins(),
      meals: [],
    });

    const text = await kh.callToolText("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    expect(text).toContain("Could not add menu to planner");
    expect(text).toContain('recipe_uid "recipe-ghost" is not known to the local recipe store');
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("unparseable start_date → error, zero POST", async () => {
    kh.seed({
      recipes: [
        makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
        makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
      ],
      ...multiDayMenuSeed(),
      mealTypes: makeBuiltins(),
      meals: [],
    });
    const text = await kh.callToolText("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "not a date" });
    expect(text).toContain('Could not parse start_date "not a date"');
    expect(kh.client().saveMeals).not.toHaveBeenCalled();
  });

  it("saveMeals errs → error message, nothing committed", async () => {
    kh.seed({
      recipes: [
        makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
        makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
      ],
      ...multiDayMenuSeed(),
      mealTypes: makeBuiltins(),
      meals: [],
    });

    vi.mocked(kh.client().saveMeals).mockReturnValue(errAsync(new Error("network down")));

    const result = await kh.callTool("schedule_menu", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    expect(getText(result)).toContain("Failed to add menu to planner: network down");
    // The save failed and nothing was created → isError, no structuredContent.
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    // Nothing landed in the local store.
    const mealSelf = kh.stateOf("meal") as MealState;
    expect(mealSelf.store.getInDateRange().total).toBe(0);
  });
});
