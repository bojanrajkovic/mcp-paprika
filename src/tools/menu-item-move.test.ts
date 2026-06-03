import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import type { SeedData } from "../../test/support/tool-test-utils.js";
import type { MealTypeUid, MenuItemUid, MenuUid, RecipeUid } from "../ids.js";
import type { MenuItem } from "../menu-item/types.js";
import type { Menu } from "../menu/types.js";

import { makeMealType } from "../../test/cache/__fixtures__/meals.js";
import { makeMenu, makeMenuItem } from "../../test/cache/__fixtures__/menus.js";
import { makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeStubNotifier, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { moveMenuItemInputSchema, registerMoveMenuItemTool } from "./menu-item-move.js";

const TACOS_UID = "recipe-tacos" as RecipeUid;
const SOUP_UID = "recipe-soup" as RecipeUid;

// Mirrors the menu-item-write.test.ts setup: saveMenus / saveMenuItems identity-return
// their inputs. Omit `opts` to leave the menu/menuItem stores cold (the sync guard test).
function setup(opts?: { menus?: Menu[]; items?: MenuItem[] }) {
  const mockSaveMenus = vi.fn().mockImplementation(async (items: ReadonlyArray<Menu>) => items);
  const mockSaveMenuItems = vi.fn().mockImplementation(async (items: ReadonlyArray<MenuItem>) => items);
  const mockNotifySync = vi.fn().mockResolvedValue(undefined);
  const mockFlush = vi.fn().mockResolvedValue(undefined);
  const { notifier } = makeStubNotifier();
  const { server, callTool } = makeTestServer();

  const ctx = makeCtx(new RecipeStore(), server, {
    client: fromAny({ saveMenus: mockSaveMenus, saveMenuItems: mockSaveMenuItems, notifySync: mockNotifySync }),
    cache: fromAny({
      menus: { put: vi.fn(), remove: vi.fn() },
      menuItems: { put: vi.fn(), remove: vi.fn() },
      flush: mockFlush,
    }),
    notifier,
  });

  const seedData: SeedData = {
    recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" }), makeRecipe({ uid: SOUP_UID, name: "Soup" })],
    mealTypes: [makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 })],
    ...(opts !== undefined ? { menus: opts.menus ?? [], menuItems: opts.items ?? [] } : {}),
  };
  seed(ctx, seedData);

  return { ctx, server, callTool, mockSaveMenus, mockSaveMenuItems };
}

describe("move_menu_item tool", () => {
  it("returns sync-not-ready message when stores not loaded", async () => {
    const { ctx, server, callTool } = setup();
    registerMoveMenuItemTool(server, ctx);

    const text = getText(await callTool("move_menu_item", { uid: "mi-1", day: 2 }));
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
    const { ctx, server, callTool, mockSaveMenus, mockSaveMenuItems } = setup({ menus: [menu], items: [item] });
    registerMoveMenuItemTool(server, ctx);

    const text = getText(await callTool("move_menu_item", { uid: "mi-1", day: 5 }));

    expect(mockSaveMenus).toHaveBeenCalledOnce();
    expect((mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!.days).toBe(5);
    // menu extended and saved BEFORE the item move
    expect(mockSaveMenus.mock.invocationCallOrder[0]!).toBeLessThan(mockSaveMenuItems.mock.invocationCallOrder[0]!);
    expect((mockSaveMenuItems.mock.calls[0]![0] as MenuItem[])[0]!.day).toBe(5);
    expect(text).toContain("Extended the menu to 5 day(s).");
    expect(text).toContain("moved to day 5");
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
    const { ctx, server, callTool, mockSaveMenus, mockSaveMenuItems } = setup({ menus: [menu], items: [item] });
    registerMoveMenuItemTool(server, ctx);

    await callTool("move_menu_item", { uid: "mi-1", day: 3 });

    expect(mockSaveMenus).not.toHaveBeenCalled();
    expect((mockSaveMenuItems.mock.calls[0]![0] as MenuItem[])[0]!.day).toBe(3);
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
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ menus: [menu], items: [moving, onDay2, onDay3] });
    registerMoveMenuItemTool(server, ctx);

    await callTool("move_menu_item", { uid: "mi-move", day: 2 });

    const saved = (mockSaveMenuItems.mock.calls[0]![0] as MenuItem[])[0]!;
    expect(saved.day).toBe(2);
    expect(saved.orderFlag).toBe(3); // menu-wide max (2) + 1
  });

  it("is an idempotent no-op when the item is already on the requested day", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", day: 2, name: "Tacos" });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ items: [item] });
    registerMoveMenuItemTool(server, ctx);

    const text = getText(await callTool("move_menu_item", { uid: "mi-1", day: 2 }));

    expect(text).toContain("already on day 2");
    expect(mockSaveMenuItems).not.toHaveBeenCalled();
  });

  it("reports a UID miss without saving", async () => {
    const { ctx, server, callTool, mockSaveMenuItems } = setup({});
    registerMoveMenuItemTool(server, ctx);

    const text = getText(await callTool("move_menu_item", { uid: "ghost", day: 2 }));
    expect(text).toContain('No menu item found with UID "ghost".');
    expect(mockSaveMenuItems).not.toHaveBeenCalled();
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
