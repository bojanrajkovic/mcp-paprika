import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeUid } from "../../meal-type/ids.js";
import type { RecipeUid } from "../../recipe/ids.js";
import type { MenuItemUid, MenuUid } from "../ids.js";
import type { MenuItem } from "../menu-item/types.js";
import type { Menu } from "../types.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMenu, makeMenuItem } from "../../../../test/domains/menu/__fixtures__/menus.js";
import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { moveMenuItemInputSchema } from "./menu-item-move.js";

const TACOS_UID = "recipe-tacos" as RecipeUid;
const SOUP_UID = "recipe-soup" as RecipeUid;

describe("move_menu_item tool", () => {
  const kh = useKernelHarness("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    // stores never seeded — hasSynced false
    const text = await kh.callToolText("move_menu_item", { uid: "mi-1", day: 2 });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("auto-extends the parent menu (saved first) when the move exceeds its span", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 2 });
    const item = makeMenuItem({
      uid: "mi-1" as MenuItemUid,
      menuUid: "m-1",
      day: 1,
      recipeUid: TACOS_UID,
      name: "Tacos",
      orderFlag: 0,
    });
    kh.seed({
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" }), makeRecipe({ uid: SOUP_UID, name: "Soup" })],
      mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
      menus: [menu],
      menuItems: [item],
    });

    vi.mocked(kh.client().saveMenus).mockImplementation((items: ReadonlyArray<Menu>) => okAsync([...items]));
    vi.mocked(kh.client().saveMenuItems).mockImplementation((items: ReadonlyArray<MenuItem>) => okAsync([...items]));

    const result = await kh.callTool("move_menu_item", { uid: "mi-1", day: 5 });

    expect(kh.client().saveMenus).toHaveBeenCalledOnce();
    expect((vi.mocked(kh.client().saveMenus).mock.calls[0]![0] as Menu[])[0]!.days).toBe(5);
    // menu extended and saved BEFORE the item move
    expect(vi.mocked(kh.client().saveMenus).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(kh.client().saveMenuItems).mock.invocationCallOrder[0]!,
    );
    expect((vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[])[0]!.day).toBe(5);
    const text = getText(result);
    expect(text).toContain("Extended the menu to 5 day(s).");
    expect(text).toContain("moved to day 5");
    // The whole parent menu (auto-expanded, item moved to day 5) rides structuredContent.
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      uid: "m-1",
      days: 5,
      items: [{ uid: "mi-1", name: "Tacos", day: 5 }],
    });
  });

  it("does NOT extend the menu when the new day is within span", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, days: 4 });
    const item = makeMenuItem({
      uid: "mi-1" as MenuItemUid,
      menuUid: "m-1",
      day: 1,
      recipeUid: TACOS_UID,
      name: "Tacos",
    });
    kh.seed({
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" }), makeRecipe({ uid: SOUP_UID, name: "Soup" })],
      mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
      menus: [menu],
      menuItems: [item],
    });

    vi.mocked(kh.client().saveMenuItems).mockImplementation((items: ReadonlyArray<MenuItem>) => okAsync([...items]));

    await kh.callTool("move_menu_item", { uid: "mi-1", day: 3 });

    expect(kh.client().saveMenus).not.toHaveBeenCalled();
    expect((vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[])[0]!.day).toBe(3);
  });

  it("re-sequences the moved item to the menu-wide max+1 (not per-day)", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, days: 3 });
    const moving = makeMenuItem({
      uid: "mi-move" as MenuItemUid,
      menuUid: "m-1",
      day: 1,
      recipeUid: TACOS_UID,
      name: "Tacos",
      orderFlag: 0,
    });
    const onDay2 = makeMenuItem({
      uid: "mi-2" as MenuItemUid,
      menuUid: "m-1",
      day: 2,
      recipeUid: SOUP_UID,
      name: "Soup",
      orderFlag: 1,
    });
    // A higher flag on a *third* day proves the new flag is menu-wide, not per-day:
    // per-day(day 2) would yield 2 (dest max 1 + 1); menu-wide yields 3 (global max 2 + 1).
    const onDay3 = makeMenuItem({
      uid: "mi-3" as MenuItemUid,
      menuUid: "m-1",
      day: 3,
      recipeUid: SOUP_UID,
      name: "Soup",
      orderFlag: 2,
    });
    kh.seed({
      recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" }), makeRecipe({ uid: SOUP_UID, name: "Soup" })],
      mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
      menus: [menu],
      menuItems: [moving, onDay2, onDay3],
    });

    vi.mocked(kh.client().saveMenuItems).mockImplementation((items: ReadonlyArray<MenuItem>) => okAsync([...items]));

    await kh.callTool("move_menu_item", { uid: "mi-move", day: 2 });

    const saved = (vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[])[0]!;
    expect(saved.day).toBe(2);
    expect(saved.orderFlag).toBe(3); // menu-wide max (2) + 1
  });

  it("is an idempotent no-op (success-with-structured) when the item is already on the requested day", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 3 });
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", day: 2, name: "Tacos" });
    // All three guard stores must be seeded (menus + items + mealTypes) — the guard
    // checks hasSynced on every store before dispatching.
    kh.seed({
      menus: [menu],
      menuItems: [item],
      mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
    });

    const result = await kh.callTool("move_menu_item", { uid: "mi-1", day: 2 });

    // Nothing changed, but this is a SUCCESS — it echoes the parent menu, not an error.
    expect(result.isError).toBeUndefined();
    expect(getText(result)).toContain("already on day 2");
    expect(result.structuredContent).toMatchObject({
      uid: "m-1",
      items: [{ uid: "mi-1", name: "Tacos", day: 2 }],
    });
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
  });

  it("an orphaned item (null menuUid) is an isError — it has no parent menu to move within", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: null, day: 1, name: "Leftovers" });
    kh.seed({
      menus: [],
      menuItems: [item],
      mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
    });

    const result = await kh.callTool("move_menu_item", { uid: "mi-1", day: 2 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain("has no parent menu");
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
  });

  it("reports a UID miss without saving", async () => {
    // All three guard stores must be seeded — empty arrays mark hasSynced true.
    kh.seed({
      menus: [],
      menuItems: [],
      mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
    });

    const result = await kh.callTool("move_menu_item", { uid: "ghost", day: 2 });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain(
      'No menu item found with UID "ghost" (it may not exist or was already deleted). Use `read_menu` to inspect its menu.',
    );
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
  });

  describe("input schema", () => {
    it("requires a day", () => {
      expect(moveMenuItemInputSchema.safeParse({ uid: "mi-1" }).success).toBe(false);
    });

    it("rejects unknown keys (strict)", () => {
      expect(moveMenuItemInputSchema.safeParse({ uid: "mi-1", day: 2, type: { name: "Dinner" } }).success).toBe(false);
    });
  });
});
