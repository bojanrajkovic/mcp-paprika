import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeMenu, makeMenuItem } from "../cache/__fixtures__/menus.js";
import { makeMealType } from "../cache/__fixtures__/meals.js";
import { makeTestServer, makeCtx, getText, makeStubNotifier, seed } from "./tool-test-utils.js";
import type { SeedData } from "./tool-test-utils.js";
import { registerCreateMenuTool, registerUpdateMenuTool, registerDeleteMenuTool } from "./menu-write.js";
import type { MealTypeUid, MenuItemUid, MenuUid } from "../ids.js";
import type { MenuItem } from "../menu-item/types.js";
import type { Menu } from "../menu/types.js";

const DINNER_TYPE = makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 });

// Builds a write-tool ctx with mocked client + cache. `saveMenus` / `saveMenuItems`
// identity-return their inputs (matching the real client's `{result: true}` behavior).
// `seedOverrides` merges over the synced baseline (mealTypes seeded, menus + menuItems
// from opts); omit menus/menuItems to leave those stores cold for guard tests.
function makeWriteToolCtx(seedOverrides?: SeedData) {
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
  if (seedOverrides !== undefined) {
    seed(ctx, { mealTypes: [DINNER_TYPE], ...seedOverrides });
  }

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

describe("create_menu tool", () => {
  it("returns sync-not-ready message when stores not loaded", async () => {
    const { ctx, server, callTool } = makeWriteToolCtx();
    // DO NOT pass menus/menuItems keys — stores stay cold
    registerCreateMenuTool(server, ctx);

    const text = getText(await callTool("create_menu", { name: "Holiday" }));
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("creates a menu with uppercase UUID, default days, and renders markdown", async () => {
    const { ctx, server, callTool, mockSaveMenus, resourceListChanged } = makeWriteToolCtx({
      menus: [],
      menuItems: [],
    });
    registerCreateMenuTool(server, ctx);

    const text = getText(await callTool("create_menu", { name: "Holiday" }));

    expect(text).toContain("# Holiday");
    expect(text).toContain("**Days:** 1");
    expect(mockSaveMenus).toHaveBeenCalledOnce();
    const savedArg = (mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!;
    expect(savedArg.name).toBe("Holiday");
    expect(savedArg.days).toBe(1);
    expect(savedArg.notes).toBe("");
    expect(savedArg.deleted).toBe(false);
    expect(savedArg.uid).toMatch(/^[0-9A-F-]{36}$/);
    expect(resourceListChanged).toHaveBeenCalledOnce();
    expect(ctx.menuStore.getAll()).toHaveLength(1);
  });

  it("honors explicit days and notes", async () => {
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [], menuItems: [] });
    registerCreateMenuTool(server, ctx);

    const text = getText(await callTool("create_menu", { name: "Week", days: 7, notes: "low carb" }));

    const savedArg = (mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!;
    expect(savedArg.days).toBe(7);
    expect(savedArg.notes).toBe("low carb");
    expect(text).toContain("**Notes:** low carb");
  });

  it("assigns the next free orderFlag", async () => {
    const existing = makeMenu({ uid: "m-1" as MenuUid, name: "First", orderFlag: 4 });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [existing], menuItems: [] });
    registerCreateMenuTool(server, ctx);

    await callTool("create_menu", { name: "Second" });

    const savedArg = (mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!;
    expect(savedArg.orderFlag).toBe(5);
  });

  it("rejects a duplicate name (exact, case-insensitive) and surfaces the existing UID", async () => {
    const existing = makeMenu({ uid: "m-dup" as MenuUid, name: "Thanksgiving" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [existing], menuItems: [] });
    registerCreateMenuTool(server, ctx);

    const text = getText(await callTool("create_menu", { name: "thanksgiving" }));

    expect(text).toContain("already exists");
    expect(text).toContain("m-dup");
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("allows creation when the name only matches by starts-with, not exact", async () => {
    const existing = makeMenu({ uid: "m-pre" as MenuUid, name: "Thanksgiving Dinner" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [existing], menuItems: [] });
    registerCreateMenuTool(server, ctx);

    getText(await callTool("create_menu", { name: "Thanksgiving" }));
    expect(mockSaveMenus).toHaveBeenCalledOnce();
  });
});

describe("update_menu tool", () => {
  it("returns sync-not-ready message when stores not loaded", async () => {
    const { ctx, server, callTool } = makeWriteToolCtx();
    // DO NOT pass menus/menuItems keys — stores stay cold
    registerUpdateMenuTool(server, ctx);

    const text = getText(await callTool("update_menu", { lookup: { uid: "m-1" }, name: "X" }));
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("rejects when no mutable field is provided", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [menu], menuItems: [] });
    registerUpdateMenuTool(server, ctx);

    const text = getText(await callTool("update_menu", { lookup: { uid: "m-1" } }));
    expect(text).toContain("Nothing to update");
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("partial-merges name, days, and notes", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Old", days: 2, notes: "old notes" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [menu], menuItems: [] });
    registerUpdateMenuTool(server, ctx);

    const text = getText(await callTool("update_menu", { lookup: { uid: "m-1" }, name: "New", days: 4 }));

    const savedArg = (mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!;
    expect(savedArg.name).toBe("New");
    expect(savedArg.days).toBe(4);
    expect(savedArg.notes).toBe("old notes"); // preserved
    expect(text).toContain("# New");
    expect(text).toContain("**Days:** 4");
  });

  it("rejects a rename that collides with a different menu's name", async () => {
    const a = makeMenu({ uid: "m-1" as MenuUid, name: "Weeknights" });
    const b = makeMenu({ uid: "m-2" as MenuUid, name: "Holiday" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [a, b], menuItems: [] });
    registerUpdateMenuTool(server, ctx);

    const text = getText(await callTool("update_menu", { lookup: { uid: "m-1" }, name: "Holiday" }));
    expect(text).toContain('A menu named "Holiday" already exists (UID: m-2).');
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("allows a no-op rename to the menu's own name (case-insensitive) alongside another change", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", notes: "old" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [menu], menuItems: [] });
    registerUpdateMenuTool(server, ctx);

    getText(await callTool("update_menu", { lookup: { uid: "m-1" }, name: "holiday", notes: "new" }));
    const savedArg = (mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!;
    expect(savedArg.notes).toBe("new");
  });

  it("resolves the menu by name", async () => {
    const menu = makeMenu({ uid: "m-named" as MenuUid, name: "Summer Plan" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [menu], menuItems: [] });
    registerUpdateMenuTool(server, ctx);

    getText(await callTool("update_menu", { lookup: { name: "summer" }, notes: "beach" }));
    const savedArg = (mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!;
    expect(savedArg.notes).toBe("beach");
  });

  it("reports a UID miss without saving", async () => {
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [], menuItems: [] });
    registerUpdateMenuTool(server, ctx);

    const text = getText(await callTool("update_menu", { lookup: { uid: "ghost" }, name: "X" }));
    expect(text).toContain('No menu found with UID "ghost".');
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("disambiguates when a name matches multiple menus", async () => {
    const a = makeMenu({ uid: "m-a" as MenuUid, name: "Summer Plan A" });
    const b = makeMenu({ uid: "m-b" as MenuUid, name: "Summer Plan B" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [a, b], menuItems: [] });
    registerUpdateMenuTool(server, ctx);

    const text = getText(await callTool("update_menu", { lookup: { name: "summer" }, days: 3 }));
    expect(text).toContain('Multiple menus match "summer"');
    expect(text).toContain("`m-a`");
    expect(text).toContain("`m-b`");
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("rejects a days-shrink that would orphan menuitems, naming the conflicts", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Big Plan", days: 5 });
    const day3 = makeMenuItem({ uid: "mi-3" as MenuItemUid, menuUid: "m-1", day: 3, name: "Soup" });
    const day5 = makeMenuItem({ uid: "mi-5" as MenuItemUid, menuUid: "m-1", day: 5, name: "Steak" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({
      menus: [menu],
      menuItems: [day3, day5],
    });
    registerUpdateMenuTool(server, ctx);

    const text = getText(await callTool("update_menu", { lookup: { uid: "m-1" }, days: 2 }));

    expect(text).toContain("Cannot shrink");
    expect(text).toContain('"Soup" on day 3');
    expect(text).toContain('"Steak" on day 5');
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("allows a days-shrink that keeps every menuitem in range", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 5 });
    const day2 = makeMenuItem({ uid: "mi-2" as MenuItemUid, menuUid: "m-1", day: 2, name: "Soup" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [menu], menuItems: [day2] });
    registerUpdateMenuTool(server, ctx);

    getText(await callTool("update_menu", { lookup: { uid: "m-1" }, days: 3 }));
    const savedArg = (mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!;
    expect(savedArg.days).toBe(3);
  });
});

describe("delete_menu tool", () => {
  it("returns sync-not-ready message when stores not loaded", async () => {
    const { ctx, server, callTool } = makeWriteToolCtx();
    // DO NOT pass menus/menuItems keys — stores stay cold
    registerDeleteMenuTool(server, ctx);

    const text = getText(await callTool("delete_menu", { lookup: { uid: "m-1" } }));
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("deletes an empty menu (no menuitems) and tombstones only the menu", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Empty" });
    const { ctx, server, callTool, mockSaveMenus, mockSaveMenuItems, resourceListChanged } = makeWriteToolCtx({
      menus: [menu],
      menuItems: [],
    });
    registerDeleteMenuTool(server, ctx);

    const text = getText(await callTool("delete_menu", { lookup: { uid: "m-1" } }));

    expect(text).toContain('Menu "Empty" has been deleted.');
    expect(mockSaveMenuItems).not.toHaveBeenCalled();
    expect(mockSaveMenus).toHaveBeenCalledOnce();
    const savedMenu = (mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!;
    expect(savedMenu.deleted).toBe(true);
    expect(ctx.menuStore.get("m-1" as MenuUid)).toBeUndefined();
    expect(ctx.menuStore.isTombstone("m-1" as MenuUid)).toBe(true);
    expect(resourceListChanged).toHaveBeenCalled();
  });

  it("cascades the tombstone to every menuitem before tombstoning the menu", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday" });
    const item1 = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", name: "Turkey" });
    const item2 = makeMenuItem({ uid: "mi-2" as MenuItemUid, menuUid: "m-1", name: "Pie" });
    const { ctx, server, callTool, mockSaveMenus, mockSaveMenuItems } = makeWriteToolCtx({
      menus: [menu],
      menuItems: [item1, item2],
    });
    registerDeleteMenuTool(server, ctx);

    const text = getText(await callTool("delete_menu", { lookup: { uid: "m-1" } }));

    expect(text).toContain('Menu "Holiday" and its 2 planned recipe(s) has been deleted.');

    // children tombstoned in one batch, all with deleted: true
    expect(mockSaveMenuItems).toHaveBeenCalledOnce();
    const savedItems = mockSaveMenuItems.mock.calls[0]![0] as MenuItem[];
    expect(savedItems).toHaveLength(2);
    expect(savedItems.every((i) => i.deleted)).toBe(true);
    // cascade tombstones null the back-reference, matching the wire capture
    expect(savedItems.every((i) => i.menuUid === null)).toBe(true);

    // parent tombstoned after
    expect(mockSaveMenus).toHaveBeenCalledOnce();
    expect((mockSaveMenus.mock.calls[0]![0] as Menu[])[0]!.deleted).toBe(true);

    // children invocation ordered before the parent invocation
    expect(mockSaveMenuItems.mock.invocationCallOrder[0]!).toBeLessThan(mockSaveMenus.mock.invocationCallOrder[0]!);

    // stores reflect the cascade
    expect(ctx.menuItemStore.getByMenuUid("m-1" as MenuUid)).toHaveLength(0);
    expect(ctx.menuStore.get("m-1" as MenuUid)).toBeUndefined();
  });

  it("reports a UID miss without saving", async () => {
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [], menuItems: [] });
    registerDeleteMenuTool(server, ctx);

    const text = getText(await callTool("delete_menu", { lookup: { uid: "ghost" } }));
    expect(text).toContain('No menu found with UID "ghost".');
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("disambiguates a name that matches multiple menus without deleting", async () => {
    const a = makeMenu({ uid: "m-a" as MenuUid, name: "Weekly Plan A" });
    const b = makeMenu({ uid: "m-b" as MenuUid, name: "Weekly Plan B" });
    const { ctx, server, callTool, mockSaveMenus } = makeWriteToolCtx({ menus: [a, b], menuItems: [] });
    registerDeleteMenuTool(server, ctx);

    const text = getText(await callTool("delete_menu", { lookup: { name: "weekly" } }));
    expect(text).toContain('Multiple menus match "weekly"');
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });

  it("does not tombstone the menu when the cascade item save fails", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday" });
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", name: "Turkey" });
    const { ctx, server, callTool, mockSaveMenus, mockSaveMenuItems } = makeWriteToolCtx({
      menus: [menu],
      menuItems: [item],
    });
    mockSaveMenuItems.mockRejectedValueOnce(new Error("network down"));
    registerDeleteMenuTool(server, ctx);

    const text = getText(await callTool("delete_menu", { lookup: { uid: "m-1" } }));

    expect(text).toContain("Failed to delete the recipes");
    expect(text).toContain("The menu was NOT deleted");
    expect(mockSaveMenus).not.toHaveBeenCalled();
  });
});
