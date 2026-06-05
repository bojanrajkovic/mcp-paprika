import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeUid, MenuItemUid, MenuUid, RecipeUid } from "../../../ids.js";
import type { MenuItem } from "../menu-item/types.js";
import type { MenuSelf } from "../module.js";
import type { Menu } from "../types.js";

import { makeMealType } from "../../../../test/cache/__fixtures__/meals.js";
import { makeMenu, makeMenuItem } from "../../../../test/cache/__fixtures__/menus.js";
import { makeRecipe } from "../../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { updateMenuItemInputSchema } from "./menu-item-update.js";
import { addMenuItemsInputSchema } from "./menu-item-write.js";

const TACOS_UID = "recipe-tacos" as RecipeUid;
const SOUP_UID = "recipe-soup" as RecipeUid;

// Seed the common recipes + mealTypes used across most cases.
// opts.menus and opts.menuItems default to [] when provided; omit opts to leave
// menu/menuItem stores cold (for the "stores not loaded" guard test).
function seedBase(kh: ReturnType<typeof useKernelHarness>, opts?: { menus?: Menu[]; menuItems?: MenuItem[] }): void {
  kh.seed({
    recipes: [makeRecipe({ uid: TACOS_UID, name: "Tacos" }), makeRecipe({ uid: SOUP_UID, name: "Soup" })],
    mealTypes: [
      makeMealType({ uid: "breakfast-uid" as MealTypeUid, name: "Breakfast", orderFlag: 0, originalType: 0 }),
      makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 }),
    ],
    ...(opts !== undefined
      ? {
          menus: opts.menus ?? [],
          menuItems: opts.menuItems ?? [],
        }
      : {}),
  });
}

describe("add_menu_items tool", () => {
  const kh = useKernelHarness("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    // Omit opts entirely → menus/menuItems stores stay cold
    seedBase(kh);
    const text = getText(
      await kh.callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [{ recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } }],
      }),
    );
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("adds a batch of items and denormalizes the recipe name", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 2 });
    seedBase(kh, { menus: [menu] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    const text = getText(
      await kh.callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [
          { recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } },
          { recipe_uid: SOUP_UID, day: 2, type: { builtin: 0 } },
        ],
      }),
    );

    expect(kh.client().saveMenus).not.toHaveBeenCalled(); // no auto-expand needed (days=2)
    expect(kh.client().saveMenuItems).toHaveBeenCalledOnce();
    const saved = vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[];
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
    expect(kh.resourceListChanged()).toHaveBeenCalled();
    expect((kh.self() as MenuSelf).items.store.getByMenuUid("m-1" as MenuUid)).toHaveLength(2);
  });

  it("adds a freeform menuitem (name, no recipe_uid) materializing recipeUid null", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 1 });
    seedBase(kh, { menus: [menu] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    const text = getText(
      await kh.callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [{ name: "Leftover Surprise", day: 1, type: { name: "Dinner" } }],
      }),
    );

    expect(kh.client().saveMenuItems).toHaveBeenCalledOnce();
    const saved = vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[];
    expect(saved).toHaveLength(1);
    expect(saved[0]!.recipeUid).toBe(null);
    expect(saved[0]!.name).toBe("Leftover Surprise");
    expect(saved[0]!.typeUid).toBe("dinner-uid");
    expect(saved[0]!.deleted).toBe(false);
    expect(text).toContain("Leftover Surprise");
  });

  it("mixes recipe-linked and freeform items in one batch", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 1 });
    seedBase(kh, { menus: [menu] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    await kh.callTool("add_menu_items", {
      menu: { uid: "m-1" },
      items: [
        { recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } },
        { name: "Leftovers", day: 1, type: { name: "Dinner" } },
      ],
    });

    const saved = vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[];
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
    seedBase(kh, { menus: [menu], menuItems: [existing] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    await kh.callTool("add_menu_items", {
      menu: { uid: "m-1" },
      items: [
        { recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } },
        { recipe_uid: SOUP_UID, day: 1, type: { name: "Dinner" } },
      ],
    });

    const saved = vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[];
    expect(saved.map((i) => i.orderFlag)).toEqual([1, 2]);
  });

  it("numbers order_flag menu-wide across days, not per-day (matches the wire capture)", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 3 });
    seedBase(kh, { menus: [menu] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    await kh.callTool("add_menu_items", {
      menu: { uid: "m-1" },
      items: [
        { recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } },
        { recipe_uid: SOUP_UID, day: 3, type: { name: "Dinner" } },
      ],
    });

    // day-1 item = 0, day-3 item = 1 (menu-wide), mirroring menus.har.json's multi-day menu.
    const saved = vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[];
    expect(saved.find((i) => i.day === 1)!.orderFlag).toBe(0);
    expect(saved.find((i) => i.day === 3)!.orderFlag).toBe(1);
  });

  it("auto-expands the menu day span when an item overflows it, committing the menu first", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 1 });
    seedBase(kh, { menus: [menu] });
    vi.mocked(kh.client().saveMenus).mockImplementation(async (items: ReadonlyArray<Menu>) => [...items]);
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    const text = getText(
      await kh.callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [{ recipe_uid: TACOS_UID, day: 3, type: { name: "Dinner" } }],
      }),
    );

    // Menu extended to 3 days and saved BEFORE the items.
    expect(kh.client().saveMenus).toHaveBeenCalledOnce();
    const savedMenu = (vi.mocked(kh.client().saveMenus).mock.calls[0]![0] as Menu[])[0]!;
    expect(savedMenu.days).toBe(3);
    expect(kh.client().saveMenuItems).toHaveBeenCalledOnce();
    expect(vi.mocked(kh.client().saveMenus).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(kh.client().saveMenuItems).mock.invocationCallOrder[0]!,
    );
    expect(text).toContain('Extended menu "Holiday" to 3 day(s).');
    expect((kh.self() as MenuSelf).menus.store.get("m-1" as MenuUid)!.days).toBe(3);
  });

  it("does NOT expand the menu when all days are in range", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 5 });
    seedBase(kh, { menus: [menu] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    await kh.callTool("add_menu_items", {
      menu: { uid: "m-1" },
      items: [{ recipe_uid: TACOS_UID, day: 5, type: { name: "Dinner" } }],
    });

    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("collects ALL per-index errors (unknown recipe + unknown type) and saves nothing", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 3 });
    seedBase(kh, { menus: [menu] });

    const text = getText(
      await kh.callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [
          { recipe_uid: "recipe-ghost" as RecipeUid, day: 1, type: { name: "Dinner" } },
          { recipe_uid: TACOS_UID, day: 2, type: { uid: "NOPE" as MealTypeUid } },
        ],
      }),
    );

    expect(text).toContain("Could not add 2 menu items:");
    expect(text).toContain('Item 0: recipe_uid "recipe-ghost" is not known');
    expect(text).toContain('Item 1: unknown meal type UID "NOPE"');
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("reports a menu UID miss without saving", async () => {
    seedBase(kh, {});

    const text = getText(
      await kh.callTool("add_menu_items", {
        menu: { uid: "ghost" },
        items: [{ recipe_uid: TACOS_UID, day: 1, type: { name: "Dinner" } }],
      }),
    );
    expect(text).toContain('No menu found with UID "ghost" (it may not exist or was already deleted).');
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
  });

  it("unknown type {name} auto-creates a custom type and adds the item with it (#224)", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 3 });
    seedBase(kh, { menus: [menu] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);
    vi.mocked(kh.client().saveMealType).mockImplementation(async (mt) => mt);

    await kh.callTool("add_menu_items", {
      menu: { uid: "m-1" },
      items: [{ recipe_uid: TACOS_UID, day: 1, type: { name: "Brunch" } }],
    });

    expect(kh.client().saveMealType).toHaveBeenCalledOnce();
    const createdType = vi.mocked(kh.client().saveMealType).mock.calls[0]![0];
    expect(createdType.name).toBe("Brunch");
    expect(createdType.originalType).toBeNull();

    const savedItem = vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0][0]!;
    expect(savedItem.typeUid).toBe(createdType.uid);
  });

  it("a batch rejected in validation creates NO meal type (pure-validate-first)", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 3 });
    seedBase(kh, { menus: [menu] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);
    vi.mocked(kh.client().saveMealType).mockImplementation(async (mt) => mt);

    const text = getText(
      await kh.callTool("add_menu_items", {
        menu: { uid: "m-1" },
        items: [
          { recipe_uid: TACOS_UID, day: 1, type: { name: "Brunch" } },
          { recipe_uid: "recipe-ghost" as RecipeUid, day: 2, type: { builtin: 2 } },
        ],
      }),
    );

    expect(text).toContain("Could not add");
    expect(kh.client().saveMealType).not.toHaveBeenCalled();
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
  });
});

describe("update_menu_item tool", () => {
  const kh = useKernelHarness("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    // Omit opts entirely → menus/menuItems stores stay cold
    seedBase(kh);
    const text = getText(await kh.callTool("update_menu_item", { uid: "mi-1", type: { name: "Dinner" } }));
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("rejects when no mutable field is provided", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1" });
    seedBase(kh, { menuItems: [item] });

    const text = getText(await kh.callTool("update_menu_item", { uid: "mi-1" }));
    expect(text).toContain("Nothing to update");
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
  });

  it("merges a type change, preserving the recipe link, name, and day", async () => {
    const item = makeMenuItem({
      uid: "mi-1" as MenuItemUid,
      menuUid: "m-1",
      recipeUid: TACOS_UID,
      name: "Tacos",
      day: 1,
      typeUid: "dinner-uid",
      orderFlag: 0,
    });
    seedBase(kh, { menuItems: [item] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    await kh.callTool("update_menu_item", { uid: "mi-1", type: { name: "Breakfast" } });

    const saved = (vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[])[0]!;
    expect(saved.typeUid).toBe("breakfast-uid");
    expect(saved.day).toBe(1); // unchanged — day-moves go through move_menu_item
    expect(saved.recipeUid).toBe(TACOS_UID); // preserved
    expect(saved.name).toBe("Tacos"); // preserved
  });

  it("re-resolves the display name when recipe_uid changes", async () => {
    const item = makeMenuItem({
      uid: "mi-1" as MenuItemUid,
      menuUid: "m-1",
      recipeUid: TACOS_UID,
      name: "Tacos",
    });
    seedBase(kh, { menuItems: [item] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    await kh.callTool("update_menu_item", { uid: "mi-1", recipe_uid: SOUP_UID });

    const saved = (vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[])[0]!;
    expect(saved.recipeUid).toBe(SOUP_UID);
    expect(saved.name).toBe("Soup"); // refreshed from recipe store
  });

  it("rejects an unknown recipe_uid without saving", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1" });
    seedBase(kh, { menuItems: [item] });

    const text = getText(
      await kh.callTool("update_menu_item", { uid: "mi-1", recipe_uid: "recipe-ghost" as RecipeUid }),
    );
    expect(text).toContain("is not known to the local recipe store");
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
  });

  it("reports a UID miss without saving", async () => {
    seedBase(kh, {});

    const text = getText(await kh.callTool("update_menu_item", { uid: "ghost", type: { name: "Dinner" } }));
    expect(text).toContain('No menu item found with UID "ghost" (it may not exist or was already deleted).');
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
  });

  it("rejects a stray day key — day-moves are promoted to move_menu_item", () => {
    expect(updateMenuItemInputSchema.safeParse({ uid: "mi-1", day: 2 }).success).toBe(false);
  });
});

describe("delete_menu_item tool", () => {
  const kh = useKernelHarness("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("removes the item from the store and reports deletion", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", name: "Turkey" });
    kh.seed({ menus: [], menuItems: [item], mealTypes: [] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    const text = getText(await kh.callTool("delete_menu_item", { uid: "mi-1" }));

    expect(text).toContain('Menu item "Turkey" has been deleted.');
    const saved = (vi.mocked(kh.client().saveMenuItems).mock.calls[0]![0] as MenuItem[])[0]!;
    expect(saved.deleted).toBe(true);
    expect((kh.self() as MenuSelf).items.store.get("mi-1" as MenuItemUid)).toBeUndefined();
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("is idempotent: a second delete returns 'already deleted' without re-POSTing", async () => {
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", name: "Turkey" });
    kh.seed({ menus: [], menuItems: [item], mealTypes: [] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation(async (items: ReadonlyArray<MenuItem>) => [...items]);

    await kh.callTool("delete_menu_item", { uid: "mi-1" });
    expect(kh.client().saveMenuItems).toHaveBeenCalledOnce();

    const text = getText(await kh.callTool("delete_menu_item", { uid: "mi-1" }));
    expect(text).toContain('No menu item found with UID "mi-1" (it may not exist or was already deleted).');
    expect(kh.client().saveMenuItems).toHaveBeenCalledOnce(); // not called a second time
  });

  it("reports a UID miss (never existed) without saving", async () => {
    kh.seed({ menus: [], menuItems: [], mealTypes: [] });

    const text = getText(await kh.callTool("delete_menu_item", { uid: "ghost" }));
    expect(text).toContain('No menu item found with UID "ghost" (it may not exist or was already deleted).');
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
  });
});
