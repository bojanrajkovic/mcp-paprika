// pattern: Imperative Shell tests
import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { MealStore } from "../cache/meal-store.js";
import { MealTypeStore } from "../cache/meal-type-store.js";
import { MenuStore } from "../cache/menu-store.js";
import { MenuItemStore } from "../cache/menu-item-store.js";
import { makeMeal, makeMealType } from "../cache/__fixtures__/meals.js";
import { makeMenu, makeMenuItem } from "../cache/__fixtures__/menus.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { registerAddMenuToPlannerTool } from "./meal-add-menu.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { Meal, MealTypeUid, Menu, MenuItem, MenuUid, RecipeUid } from "../paprika/types.js";

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

type SetupOpts = {
  readonly recipeSynced?: boolean;
  readonly menuSynced?: boolean;
  readonly mealTypeSynced?: boolean;
  readonly mealSynced?: boolean;
  readonly menus?: ReadonlyArray<Menu>;
  readonly items?: ReadonlyArray<MenuItem>;
  readonly existingMeals?: ReadonlyArray<Meal>;
  readonly saveMealsImpl?: (items: ReadonlyArray<Meal>) => Promise<ReadonlyArray<Meal>>;
};

function setup(opts: SetupOpts = {}) {
  const recipeStore = new RecipeStore();
  if (opts.recipeSynced !== false) {
    recipeStore.load([
      makeRecipe({ uid: BUTTER_CHICKEN_UID, name: "(Not) Butter Chicken" }),
      makeRecipe({ uid: HONEY_MUSTARD_UID, name: "20 Minute Honey Mustard Chicken" }),
    ]);
  }

  const menuStore = new MenuStore();
  const menuItemStore = new MenuItemStore();
  if (opts.menuSynced !== false) {
    menuStore.load(opts.menus ?? []);
    menuItemStore.load(opts.items ?? []);
  }

  const mealTypeStore = new MealTypeStore();
  if (opts.mealTypeSynced !== false) {
    mealTypeStore.load(makeBuiltins());
  }

  const mealStore = new MealStore();
  if (opts.mealSynced !== false) {
    mealStore.load(opts.existingMeals ?? []);
  }

  const mockSaveMeals = vi.fn().mockImplementation(opts.saveMealsImpl ?? (async (items: ReadonlyArray<Meal>) => items));
  const mockNotifySync = vi.fn().mockResolvedValue(undefined);
  const mockPut = vi.fn().mockResolvedValue(undefined);
  const mockFlush = vi.fn().mockResolvedValue(undefined);

  const { server, callTool } = makeTestServer();
  const ctx = makeCtx(recipeStore, server, {
    menuStore,
    menuItemStore,
    mealStore,
    mealTypeStore,
    client: fromAny({ saveMeals: mockSaveMeals, notifySync: mockNotifySync }),
    cache: fromAny({ meals: { put: mockPut, remove: vi.fn() }, flush: mockFlush }),
  });
  registerAddMenuToPlannerTool(server, ctx);

  return { callTool, mealStore, mockSaveMeals, mockFlush, mockNotifySync };
}

/** Two Dinner items on day 1 and day 3 — the exact shape of the wire capture. */
function multiDayMenu(): { menus: Menu[]; items: MenuItem[] } {
  return {
    menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 3 })],
    items: [
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

describe("add_menu_to_planner — guards", () => {
  it("recipe store cold → recipe-sync message", async () => {
    const { callTool, mockSaveMeals } = setup({ recipeSynced: false });
    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" }),
    );
    expect(text).toContain("Recipe store is not yet synced");
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });

  it("menu store cold → menu-sync message", async () => {
    const { callTool } = setup({ menuSynced: false });
    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" }),
    );
    expect(text).toContain("Menu data is not yet synced");
  });

  it("meal-type store cold → menu-sync message (menuStartGuard gates mealTypeStore)", async () => {
    const { callTool } = setup({ mealTypeSynced: false });
    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" }),
    );
    expect(text).toContain("Menu data is not yet synced");
  });

  it("meal store cold → planner-sync message", async () => {
    const { callTool, mockSaveMeals } = setup({ mealSynced: false });
    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" }),
    );
    expect(text).toContain("Meal planner is not yet synced");
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });
});

describe("add_menu_to_planner — menu resolution", () => {
  it("uid_miss → no menu found", async () => {
    const { callTool } = setup();
    const text = getText(
      await callTool("add_menu_to_planner", { menu: { uid: "nope" as MenuUid }, start_date: "2026-05-27" }),
    );
    expect(text).toBe('No menu found with UID "nope".');
  });

  it("text_none → no menus matching", async () => {
    const { callTool } = setup();
    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Ghost Menu" }, start_date: "2026-05-27" }),
    );
    expect(text).toBe('No menus found matching "Ghost Menu".');
  });

  it("text_many → disambiguation list", async () => {
    const { callTool } = setup({
      menus: [
        makeMenu({ uid: "m-a" as MenuUid, name: "Week Plan A" }),
        makeMenu({ uid: "m-b" as MenuUid, name: "Week Plan B" }),
      ],
    });
    // "Week Plan" is a contains-match for both.
    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Week Plan" }, start_date: "2026-05-27" }),
    );
    expect(text).toContain('Multiple menus match "Week Plan"');
    expect(text).toContain("`m-a`");
    expect(text).toContain("`m-b`");
  });

  it("empty menu → informational message, no POST", async () => {
    const { callTool, mockSaveMeals } = setup({
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 3 })],
      items: [],
    });
    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" }),
    );
    expect(text).toBe('Menu "Multi-Day" has no items to add to the planner.');
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });
});

describe("add_menu_to_planner — materialization", () => {
  it("wire-capture scenario: day-1 and day-3 Dinners → start and start+2, both order_flag 0", async () => {
    const { callTool, mockSaveMeals } = setup(multiDayMenu());

    const result = await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;

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
    expect(text).not.toMatch(/`[0-9A-F-]{36}`/); // no meal UIDs
  });

  it("two items on the SAME day → flags 0 and 1 (per-date sequence within the batch)", async () => {
    const { callTool, mockSaveMeals } = setup({
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      items: [
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
    });

    await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;

    expect(payload).toHaveLength(2);
    expect(payload.map((m) => m.orderFlag).sort((a, b) => a - b)).toEqual([0, 1]);
    expect(payload.every((m) => m.date === "2026-05-27 00:00:00")).toBe(true);
  });

  it("same-day flags follow MENU LAYOUT order (meal-type order), not store insertion order", async () => {
    // The menu lists Dinner before Lunch (store-insertion order), but order_flag
    // must sequence by meal-type order within the date — Lunch (typeorder 1) gets
    // flag 0, Dinner (typeorder 2) gets flag 1 — matching the wire capture, where
    // a Breakfast/Lunch pair on one date posted as 0/1 in type order. Without the
    // layout sort the persisted flags would track arbitrary getByMenuUid order.
    const { callTool, mockSaveMeals } = setup({
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      items: [
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
    });

    await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;

    const lunch = payload.find((m) => m.typeUid === LUNCH_UID);
    const dinner = payload.find((m) => m.typeUid === DINNER_UID);
    expect(lunch?.orderFlag).toBe(0);
    expect(dinner?.orderFlag).toBe(1);
    // POST order follows layout too: Lunch before Dinner.
    expect(payload[0]?.typeUid).toBe(LUNCH_UID);
  });

  it("pre-existing planner meal on the date → new flag seeds from getMaxOrderFlagOn + 1", async () => {
    const { callTool, mockSaveMeals } = setup({
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      items: [
        makeMenuItem({
          uid: "mi-1" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: BUTTER_CHICKEN_UID,
          day: 1,
          typeUid: DINNER_UID,
        }),
      ],
      existingMeals: [makeMeal({ date: "2026-05-27 00:00:00", typeUid: BREAKFAST_UID, orderFlag: 3 })],
    });

    await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    // Existing max on the date is 3 (a Breakfast); the new Dinner seeds at 4 — per
    // date, not per type.
    expect(payload[0]?.orderFlag).toBe(4);
  });

  it("freeform menu item (recipeUid: null) → materialized from its stored name", async () => {
    const { callTool, mockSaveMeals } = setup({
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      items: [
        makeMenuItem({
          uid: "mi-free" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: null,
          name: "Leftovers Night",
          day: 1,
          typeUid: DINNER_UID,
        }),
      ],
    });

    const result = await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    expect(payload[0]?.recipeUid).toBeNull();
    expect(payload[0]?.name).toBe("Leftovers Night");
    expect(getText(result)).toContain("- **Dinner:** Leftovers Night");
  });

  it("unknown/custom typeUid → type integer falls back to 0, typeUid preserved", async () => {
    const { callTool, mockSaveMeals } = setup({
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 1 })],
      items: [
        makeMenuItem({
          uid: "mi-custom" as MenuItem["uid"],
          menuUid: MENU_UID,
          recipeUid: BUTTER_CHICKEN_UID,
          day: 1,
          typeUid: "custom-unsynced-type",
        }),
      ],
    });

    const result = await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" });
    const payload = mockSaveMeals.mock.calls[0]?.[0] as ReadonlyArray<Meal>;
    expect(payload[0]?.typeUid).toBe("custom-unsynced-type");
    expect(payload[0]?.type).toBe(0);
    // Type name falls back to the raw uid in the response when it can't be resolved.
    expect(getText(result)).toContain("- **custom-unsynced-type:**");
  });
});

describe("add_menu_to_planner — rejection paths", () => {
  it("unknown recipe → whole batch rejected, zero POST", async () => {
    const { callTool, mockSaveMeals } = setup({
      menus: [makeMenu({ uid: MENU_UID, name: "Multi-Day", days: 3 })],
      items: [
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
    });

    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" }),
    );
    expect(text).toContain("Could not add menu to planner");
    expect(text).toContain('recipe_uid "recipe-ghost" is not known to the local recipe store');
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });

  it("unparseable start_date → error, zero POST", async () => {
    const { callTool, mockSaveMeals } = setup(multiDayMenu());
    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "not a date" }),
    );
    expect(text).toContain('Could not parse start_date "not a date"');
    expect(mockSaveMeals).not.toHaveBeenCalled();
  });

  it("saveMeals throws → error message, nothing committed", async () => {
    const { callTool, mealStore } = setup({
      ...multiDayMenu(),
      saveMealsImpl: async () => {
        throw new Error("network down");
      },
    });

    const text = getText(
      await callTool("add_menu_to_planner", { menu: { name: "Multi-Day" }, start_date: "2026-05-27" }),
    );
    expect(text).toContain("Failed to add menu to planner: network down");
    // Nothing landed in the local store.
    expect(mealStore.getInDateRange().total).toBe(0);
  });
});
