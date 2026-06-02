import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../recipe/store.js";
import { makeMenu, makeMenuItem } from "../cache/__fixtures__/menus.js";
import { makeMealType } from "../cache/__fixtures__/meals.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { makeTestServer, makeCtx, getText, makeStubNotifier, seed } from "./tool-test-utils.js";
import type { SeedData } from "./tool-test-utils.js";
import {
  registerAddMenuItemsTool,
  registerUpdateMenuItemTool,
  registerDeleteMenuItemTool,
  addMenuItemsInputSchema,
} from "./menu-item-write.js";
import type { MealTypeUid, MenuItemUid, MenuUid, RecipeUid } from "../ids.js";
import type { MenuItem } from "../menu-item/types.js";
import type { Menu } from "../menu/types.js";

const TACOS_UID = "recipe-tacos" as RecipeUid;
const SOUP_UID = "recipe-soup" as RecipeUid;

// Builds a write-tool ctx with mocked client + cache. `saveMenus` / `saveMenuItems`
// identity-return their inputs (matching the real client's `{result: true}` behavior).
// Always seeds recipes (Tacos, Soup) and mealTypes (Breakfast, Dinner); opts.menus and
// opts.items default to [] (synced-but-empty). Omit opts entirely to leave menu/menuItem
// stores cold (for the "stores not loaded" guard test — pass only recipes + mealTypes).
function setup(opts?: { menus?: Menu[]; items?: MenuItem[] }) {
  const mockSaveMenus = vi.fn().mockImplementation(async (items: ReadonlyArray<Menu>) => items);
  const mockSaveMenuItems = vi.fn().mockImplementation(async (items: ReadonlyArray<MenuItem>) => items);
  const mockNotifySync = vi.fn().mockResolvedValue(undefined);
  const mockPutMenu = vi.fn();
  const mockRemoveMenu = vi.fn();
  const mockPutMenuItem = vi.fn();
  const mockRemoveMenuItem = vi.fn();
  const mockFlush = vi.fn().mockResolvedValue(undefined);
  const { notifier, resourceListChanged } = makeStubNotifier();
  const { server, callTool } = makeTestServer();

  const ctx = makeCtx(new RecipeStore(), server, {
    client: fromAny({
      saveMenus: mockSaveMenus,
      saveMenuItems: mockSaveMenuItems,
      notifySync: mockNotifySync,
    }),
    cache: fromAny({
      menus: { put: mockPutMenu, remove: mockRemoveMenu },
      menuItems: { put: mockPutMenuItem, remove: mockRemoveMenuItem },
      flush: mockFlush,
    }),
    notifier,
  });

  // Build the seed payload: always include recipes + mealTypes.
  // Include menus/menuItems only when opts is provided (omitting them leaves those
  // stores cold so the "stores not loaded" guard test fires correctly).
  const seedData: SeedData = {
    recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" }), makeRecipe({ uid: SOUP_UID, name: "Soup" })],
    mealTypes: [
      makeMealType({ uid: "breakfast-uid" as MealTypeUid, name: "Breakfast", orderFlag: 0, originalType: 0 }),
      makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 }),
    ],
    ...(opts !== undefined
      ? {
          menus: opts.menus ?? [],
          menuItems: opts.items ?? [],
        }
      : {}),
  };
  seed(ctx, seedData);

  return {
    ctx,
    server,
    callTool,
    mockSaveMenus,
    mockSaveMenuItems,
    mockNotifySync,
    mockPutMenu,
    mockRemoveMenu,
    mockPutMenuItem,
    mockRemoveMenuItem,
    mockFlush,
    resourceListChanged,
  };
}

describe("add_menu_items tool", () => {
  it("returns sync-not-ready message when stores not loaded", async () => {
    // Omit opts entirely → menus/menuItems stores stay cold
    const { ctx, server, callTool } = setup();
    registerAddMenuItemsTool(server, ctx);

    const text = getText(
      await callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [{ recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } }],
      }),
    );
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("adds a batch of items and denormalizes the recipe name", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 2 });
    const { ctx, server, callTool, mockSaveMenuItems, mockSaveMenus, resourceListChanged } = setup({
      menus: [menu],
    });
    registerAddMenuItemsTool(server, ctx);

    const text = getText(
      await callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [
          { recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } },
          { recipe_uid: SOUP_UID, day: 2, type: { builtin: 0 } },
        ],
      }),
    );

    expect(mockSaveMenus).not.toHaveBeenCalled(); // no auto-expand needed (days=2)
    expect(mockSaveMenuItems).toHaveBeenCalledOnce();
    const saved = mockSaveMenuItems.mock.calls[0]![0] as MenuItem[];
    expect(saved).toHaveLength(2);
    expect(saved[0]!.name).toBe("Tacos");
    expect(saved[0]!.recipeUid).toBe(TACOS_UID);
    expect(saved[0]!.menuUid).toBe("m-1");
    expect(saved[0]!.typeUid).toBe("dinner-uid");
    expect(saved[0]!.uid).toMatch(/^[0-9A-F-]{36}$/);
    expect(saved[1]!.name).toBe("Soup");
    expect(saved[1]!.typeUid).toBe("breakfast-uid");
    expect(saved.every((i) => !i.deleted)).toBe(true);
    expect(text).toContain('Added 2 item(s) to menu "Holiday"');
    expect(resourceListChanged).toHaveBeenCalled();
    expect(ctx.menuItemStore.getByMenuUid("m-1" as MenuUid)).toHaveLength(2);
  });

  it("adds a freeform menuitem (name, no recipe_uid) materializing recipeUid null", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 1 });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ menus: [menu] });
    registerAddMenuItemsTool(server, ctx);

    const text = getText(
      await callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [{ name: "Leftover Surprise", day: 1, type: { name: "Dinner" } }],
      }),
    );

    expect(mockSaveMenuItems).toHaveBeenCalledOnce();
    const saved = mockSaveMenuItems.mock.calls[0]![0] as MenuItem[];
    expect(saved).toHaveLength(1);
    expect(saved[0]!.recipeUid).toBe(null);
    expect(saved[0]!.name).toBe("Leftover Surprise");
    expect(saved[0]!.typeUid).toBe("dinner-uid");
    expect(saved[0]!.deleted).toBe(false);
    expect(text).toContain("Leftover Surprise");
  });

  it("mixes recipe-linked and freeform items in one batch", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 1 });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ menus: [menu] });
    registerAddMenuItemsTool(server, ctx);

    await callTool("add_menu_items", {
      menu: { uid: "m-1" },
      items: [
        { recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } },
        { name: "Leftovers", day: 1, type: { name: "Dinner" } },
      ],
    });

    const saved = mockSaveMenuItems.mock.calls[0]![0] as MenuItem[];
    expect(saved[0]!.recipeUid).toBe(TACOS_UID);
    expect(saved[0]!.name).toBe("Tacos");
    expect(saved[1]!.recipeUid).toBe(null);
    expect(saved[1]!.name).toBe("Leftovers");
  });

  it("schema accepts recipe-only and freeform variants, rejects both-at-once", () => {
    const base = { menu: { uid: "m-1" } };
    expect(
      addMenuItemsInputSchema.safeParse({ ...base, items: [{ recipe_uid: "r", day: 1, type: { name: "Dinner" } }] })
        .success,
    ).toBe(true);
    expect(
      addMenuItemsInputSchema.safeParse({ ...base, items: [{ name: "Leftovers", day: 1, type: { name: "Dinner" } }] })
        .success,
    ).toBe(true);
    expect(
      addMenuItemsInputSchema.safeParse({
        ...base,
        items: [{ recipe_uid: "r", name: "Both", day: 1, type: { name: "Dinner" } }],
      }).success,
    ).toBe(false);
  });

  it("assigns menu-wide sequential order_flag, seeded from the existing menu max", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 1 });
    // Existing item holds the menu-wide max orderFlag 0 → new items start at 1.
    const existing = makeMenuItem({ uid: "mi-existing" as MenuItemUid, menuUid: "m-1", day: 1, orderFlag: 0 });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ menus: [menu], items: [existing] });
    registerAddMenuItemsTool(server, ctx);

    await callTool("add_menu_items", {
      menu: { uid: "m-1" },
      items: [
        { recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } },
        { recipe_uid: SOUP_UID, day: 1, type: { name: "Dinner" } },
      ],
    });

    const saved = mockSaveMenuItems.mock.calls[0]![0] as MenuItem[];
    expect(saved.map((i) => i.orderFlag)).toEqual([1, 2]);
  });

  it("numbers order_flag menu-wide across days, not per-day (matches the wire capture)", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 3 });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ menus: [menu] });
    registerAddMenuItemsTool(server, ctx);

    await callTool("add_menu_items", {
      menu: { uid: "m-1" },
      items: [
        { recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } },
        { recipe_uid: SOUP_UID, day: 3, type: { name: "Dinner" } },
      ],
    });

    // day-1 item = 0, day-3 item = 1 (menu-wide), mirroring menus.har.json's multi-day menu.
    const saved = mockSaveMenuItems.mock.calls[0]![0] as MenuItem[];
    expect(saved.find((i) => i.day === 1)!.orderFlag).toBe(0);
    expect(saved.find((i) => i.day === 3)!.orderFlag).toBe(1);
  });

  it("auto-expands the menu day span when an item overflows it, committing the menu first", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 1 });
    const { ctx, server, callTool, mockSaveMenus, mockSaveMenuItems } = setup({ menus: [menu] });
    registerAddMenuItemsTool(server, ctx);

    const text = getText(
      await callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [{ recipe_uid: TACOS_UID, day: 3, type: { name: "Dinner" } }],
      }),
    );

    // Menu extended to 3 days and saved BEFORE the items.
    expect(mockSaveMenus).toHaveBeenCalledOnce();
    const savedMenu = (mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!;
    expect(savedMenu.days).toBe(3);
    expect(mockSaveMenuItems).toHaveBeenCalledOnce();
    expect(mockSaveMenus.mock.invocationCallOrder[0]!).toBeLessThan(mockSaveMenuItems.mock.invocationCallOrder[0]!);
    expect(text).toContain('Extended menu "Holiday" to 3 day(s).');
    expect(ctx.menuStore.get("m-1" as MenuUid)!.days).toBe(3);
  });

  it("does NOT expand the menu when all days are in range", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 5 });
    const { ctx, server, callTool, mockSaveMenus } = setup({ menus: [menu] });
    registerAddMenuItemsTool(server, ctx);

    await callTool("add_menu_items", {
      menu: { uid: "m-1" },
      items: [{ recipe_uid: TACOS_UID, day: 5, type: { name: "Dinner" } }],
    });

    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("collects ALL per-index errors (unknown recipe + unknown type) and saves nothing", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 3 });
    const { ctx, server, callTool, mockSaveMenuItems, mockSaveMenus } = setup({ menus: [menu] });
    registerAddMenuItemsTool(server, ctx);

    const text = getText(
      await callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [
          { recipe_uid: "recipe-ghost" as RecipeUid, day: 1, type: { name: "Dinner" } },
          { recipe_uid: TACOS_UID, day: 2, type: { name: "Brunch" } },
        ],
      }),
    );

    expect(text).toContain("Could not add 2 menu items:");
    expect(text).toContain('Item 0: recipe_uid "recipe-ghost" is not known');
    expect(text).toContain('Item 1 (type {name: "Brunch"}): unknown meal type');
    expect(mockSaveMenuItems).not.toHaveBeenCalled();
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("reports a menu UID miss without saving", async () => {
    const { ctx, server, callTool, mockSaveMenuItems } = setup({});
    registerAddMenuItemsTool(server, ctx);

    const text = getText(
      await callTool("add_menu_items", {
        menu: { uid: "ghost" },
        items: [{ recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } }],
      }),
    );
    expect(text).toContain('No menu found with UID "ghost".');
    expect(mockSaveMenuItems).not.toHaveBeenCalled();
  });
});

describe("update_menu_item tool", () => {
  it("returns sync-not-ready message when stores not loaded", async () => {
    // Omit opts entirely → menus/menuItems stores stay cold
    const { ctx, server, callTool } = setup();
    registerUpdateMenuItemTool(server, ctx);

    const text = getText(await callTool("update_menu_item", { uid: "mi-1", day: 2 }));
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("rejects when no mutable field is provided", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1" });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ items: [item] });
    registerUpdateMenuItemTool(server, ctx);

    const text = getText(await callTool("update_menu_item", { uid: "mi-1" }));
    expect(text).toContain("Nothing to update");
    expect(mockSaveMenuItems).not.toHaveBeenCalled();
  });

  it("partial-merges day and type, preserving the recipe link and name", async () => {
    const item = makeMenuItem({
      uid: "mi-1" as MenuItemUid,
      menuUid: "m-1",
      recipeUid: TACOS_UID,
      name: "Tacos",
      day: 1,
      typeUid: "dinner-uid",
      orderFlag: 0,
    });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ items: [item] });
    registerUpdateMenuItemTool(server, ctx);

    await callTool("update_menu_item", { uid: "mi-1", day: 3, type: { name: "Breakfast" } });

    const saved = (mockSaveMenuItems.mock.calls[0]![0] as MenuItem[])[0]!;
    expect(saved.day).toBe(3);
    expect(saved.typeUid).toBe("breakfast-uid");
    expect(saved.recipeUid).toBe(TACOS_UID); // preserved
    expect(saved.name).toBe("Tacos"); // preserved
  });

  it("auto-extends the parent menu (saved first) when a day-move exceeds its span", async () => {
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
    registerUpdateMenuItemTool(server, ctx);

    const text = getText(await callTool("update_menu_item", { uid: "mi-1", day: 5 }));

    // menu extended to day 5 and saved BEFORE the item move
    expect(mockSaveMenus).toHaveBeenCalledOnce();
    expect((mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!.days).toBe(5);
    expect(mockSaveMenus.mock.invocationCallOrder[0]!).toBeLessThan(mockSaveMenuItems.mock.invocationCallOrder[0]!);
    expect((mockSaveMenuItems.mock.calls[0]![0] as MenuItem[])[0]!.day).toBe(5);
    expect(text).toContain("Extended the menu to 5 day(s).");
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
    const { ctx, server, callTool, mockSaveMenus } = setup({ menus: [menu], items: [item] });
    registerUpdateMenuItemTool(server, ctx);

    await callTool("update_menu_item", { uid: "mi-1", day: 3 });
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("re-sequences a moved item to the menu-wide max+1 when the day changes", async () => {
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
    // per-day(day 2) would yield 2 (dest max 1 +1); menu-wide yields 3 (global max 2 +1).
    const onDay3 = makeMenuItem({
      uid: "mi-3" as MenuItemUid,
      menuUid: "m-1",
      day: 3,
      recipeUid: SOUP_UID,
      name: "Soup",
      orderFlag: 2,
    });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({
      menus: [menu],
      items: [moving, onDay2, onDay3],
    });
    registerUpdateMenuItemTool(server, ctx);

    await callTool("update_menu_item", { uid: "mi-move", day: 2 });
    const saved = (mockSaveMenuItems.mock.calls[0]![0] as MenuItem[])[0]!;
    expect(saved.day).toBe(2);
    expect(saved.orderFlag).toBe(3); // menu-wide max (2) + 1
  });

  it("re-resolves the display name when recipe_uid changes", async () => {
    const item = makeMenuItem({
      uid: "mi-1" as MenuItemUid,
      menuUid: "m-1",
      recipeUid: TACOS_UID,
      name: "Tacos",
    });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ items: [item] });
    registerUpdateMenuItemTool(server, ctx);

    await callTool("update_menu_item", { uid: "mi-1", recipe_uid: SOUP_UID });

    const saved = (mockSaveMenuItems.mock.calls[0]![0] as MenuItem[])[0]!;
    expect(saved.recipeUid).toBe(SOUP_UID);
    expect(saved.name).toBe("Soup"); // refreshed from RecipeStore
  });

  it("rejects an unknown recipe_uid without saving", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1" });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ items: [item] });
    registerUpdateMenuItemTool(server, ctx);

    const text = getText(await callTool("update_menu_item", { uid: "mi-1", recipe_uid: "recipe-ghost" as RecipeUid }));
    expect(text).toContain("is not known to the local recipe store");
    expect(mockSaveMenuItems).not.toHaveBeenCalled();
  });

  it("reports a UID miss without saving", async () => {
    const { ctx, server, callTool, mockSaveMenuItems } = setup({});
    registerUpdateMenuItemTool(server, ctx);

    const text = getText(await callTool("update_menu_item", { uid: "ghost", day: 2 }));
    expect(text).toContain('No menu item found with UID "ghost".');
    expect(mockSaveMenuItems).not.toHaveBeenCalled();
  });
});

describe("delete_menu_item tool", () => {
  it("tombstones the item and reports deletion", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", name: "Turkey" });
    const { ctx, server, callTool, mockSaveMenuItems, resourceListChanged } = setup({ items: [item] });
    registerDeleteMenuItemTool(server, ctx);

    const text = getText(await callTool("delete_menu_item", { uid: "mi-1" }));

    expect(text).toContain('Menu item "Turkey" has been deleted.');
    const saved = (mockSaveMenuItems.mock.calls[0]![0] as MenuItem[])[0]!;
    expect(saved.deleted).toBe(true);
    expect(ctx.menuItemStore.get("mi-1" as MenuItemUid)).toBeUndefined();
    expect(ctx.menuItemStore.isTombstone("mi-1" as MenuItemUid)).toBe(true);
    expect(resourceListChanged).toHaveBeenCalled();
  });

  it("is idempotent: a second delete returns 'already deleted' without re-POSTing", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", name: "Turkey" });
    const { ctx, server, callTool, mockSaveMenuItems } = setup({ items: [item] });
    registerDeleteMenuItemTool(server, ctx);

    await callTool("delete_menu_item", { uid: "mi-1" });
    expect(mockSaveMenuItems).toHaveBeenCalledOnce();

    const text = getText(await callTool("delete_menu_item", { uid: "mi-1" }));
    expect(text).toContain('Menu item with UID "mi-1" is already deleted.');
    expect(mockSaveMenuItems).toHaveBeenCalledOnce(); // not called a second time
  });

  it("reports a UID miss (never existed) without saving", async () => {
    const { ctx, server, callTool, mockSaveMenuItems } = setup({});
    registerDeleteMenuItemTool(server, ctx);

    const text = getText(await callTool("delete_menu_item", { uid: "ghost" }));
    expect(text).toContain('No menu item found with UID "ghost".');
    expect(mockSaveMenuItems).not.toHaveBeenCalled();
  });
});
