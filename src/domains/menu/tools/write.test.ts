import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MealTypeUid } from "../../meal-type/ids.js";
import type { MenuItemUid, MenuUid } from "../ids.js";
import type { MenuState } from "../module.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMenu, makeMenuItem } from "../../../../test/domains/menu/__fixtures__/menus.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

const DINNER_TYPE = makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 });

describe("create_menu tool", () => {
  const kh = useKernelHarness<MenuState>("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    // DO NOT seed menus/menuItems/mealTypes — stores stay cold
    const text = await kh.callToolText("create_menu", { name: "Holiday" });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("creates a menu with uppercase UUID, default days, and renders markdown", async () => {
    kh.seed({ menus: [], menuItems: [], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenus).mockReturnValue(
      okAsync([makeMenu({ name: "Holiday", days: 1, notes: "", deleted: false })]),
    );

    const text = await kh.callToolText("create_menu", { name: "Holiday" });

    expect(text).toContain("# Holiday");
    expect(text).toContain("**Days:** 1");
    expect(kh.client().saveMenus).toHaveBeenCalledOnce();
    const savedArgs = vi.mocked(kh.client().saveMenus).mock.calls[0]?.[0];
    const savedArg = savedArgs?.[0];
    expect(savedArg?.name).toBe("Holiday");
    expect(savedArg?.days).toBe(1);
    expect(savedArg?.notes).toBe("");
    expect(savedArg?.deleted).toBe(false);
    expect(savedArg?.uid).toMatch(/^[0-9A-F-]{36}$/);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
    expect(kh.state().menus.store.getAll()).toHaveLength(1);
  });

  it("honors explicit days and notes", async () => {
    kh.seed({ menus: [], menuItems: [], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenus).mockReturnValue(okAsync([makeMenu({ name: "Week", days: 7, notes: "low carb" })]));

    const text = await kh.callToolText("create_menu", { name: "Week", days: 7, notes: "low carb" });

    const savedArgs = vi.mocked(kh.client().saveMenus).mock.calls[0]?.[0];
    const savedArg = savedArgs?.[0];
    expect(savedArg?.days).toBe(7);
    expect(savedArg?.notes).toBe("low carb");
    expect(text).toContain("**Notes:** low carb");
  });

  it("assigns the next free orderFlag", async () => {
    const existing = makeMenu({ uid: "m-1" as MenuUid, name: "First", orderFlag: 4 });
    kh.seed({ menus: [existing], menuItems: [], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenus).mockReturnValue(okAsync([makeMenu({ name: "Second" })]));

    await kh.callTool("create_menu", { name: "Second" });

    const savedArgs = vi.mocked(kh.client().saveMenus).mock.calls[0]?.[0];
    const savedArg = savedArgs?.[0];
    expect(savedArg?.orderFlag).toBe(5);
  });

  it("rejects a duplicate name (exact, case-insensitive) and surfaces the existing UID", async () => {
    const existing = makeMenu({ uid: "m-dup" as MenuUid, name: "Thanksgiving" });
    kh.seed({ menus: [existing], menuItems: [], mealTypes: [DINNER_TYPE] });

    const text = await kh.callToolText("create_menu", { name: "thanksgiving" });

    expect(text).toContain("already exists");
    expect(text).toContain("m-dup");
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("allows creation when the name only matches by starts-with, not exact", async () => {
    const existing = makeMenu({ uid: "m-pre" as MenuUid, name: "Thanksgiving Dinner" });
    kh.seed({ menus: [existing], menuItems: [], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenus).mockReturnValue(okAsync([makeMenu({ name: "Thanksgiving" })]));

    await kh.callTool("create_menu", { name: "Thanksgiving" });
    expect(kh.client().saveMenus).toHaveBeenCalledOnce();
  });
});

describe("update_menu tool", () => {
  const kh = useKernelHarness<MenuState>("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    // DO NOT seed menus/menuItems/mealTypes — stores stay cold
    const text = await kh.callToolText("update_menu", { lookup: { uid: "m-1" }, name: "X" });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("rejects when no mutable field is provided", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan" });
    kh.seed({ menus: [menu], menuItems: [], mealTypes: [DINNER_TYPE] });

    const text = await kh.callToolText("update_menu", { lookup: { uid: "m-1" } });
    expect(text).toContain("Nothing to update");
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("partial-merges name, days, and notes", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Old", days: 2, notes: "old notes" });
    kh.seed({ menus: [menu], menuItems: [], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenus).mockReturnValue(
      okAsync([makeMenu({ uid: "m-1" as MenuUid, name: "New", days: 4, notes: "old notes" })]),
    );

    const text = await kh.callToolText("update_menu", { lookup: { uid: "m-1" }, name: "New", days: 4 });

    const savedArgs = vi.mocked(kh.client().saveMenus).mock.calls[0]?.[0];
    const savedArg = savedArgs?.[0];
    expect(savedArg?.name).toBe("New");
    expect(savedArg?.days).toBe(4);
    expect(savedArg?.notes).toBe("old notes"); // preserved
    expect(text).toContain("# New");
    expect(text).toContain("**Days:** 4");
  });

  it("rejects a rename that collides with a different menu's name", async () => {
    const a = makeMenu({ uid: "m-1" as MenuUid, name: "Weeknights" });
    const b = makeMenu({ uid: "m-2" as MenuUid, name: "Holiday" });
    kh.seed({ menus: [a, b], menuItems: [], mealTypes: [DINNER_TYPE] });

    const text = await kh.callToolText("update_menu", { lookup: { uid: "m-1" }, name: "Holiday" });
    expect(text).toContain('A menu named "Holiday" already exists (UID: m-2).');
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("allows a no-op rename to the menu's own name (case-insensitive) alongside another change", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", notes: "old" });
    kh.seed({ menus: [menu], menuItems: [], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenus).mockReturnValue(
      okAsync([makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", notes: "new" })]),
    );

    await kh.callTool("update_menu", { lookup: { uid: "m-1" }, name: "holiday", notes: "new" });
    const savedArgs = vi.mocked(kh.client().saveMenus).mock.calls[0]?.[0];
    const savedArg = savedArgs?.[0];
    expect(savedArg?.notes).toBe("new");
  });

  it("resolves the menu by name", async () => {
    const menu = makeMenu({ uid: "m-named" as MenuUid, name: "Summer Plan" });
    kh.seed({ menus: [menu], menuItems: [], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenus).mockReturnValue(
      okAsync([makeMenu({ uid: "m-named" as MenuUid, name: "Summer Plan", notes: "beach" })]),
    );

    await kh.callTool("update_menu", { lookup: { name: "summer" }, notes: "beach" });
    const savedArgs = vi.mocked(kh.client().saveMenus).mock.calls[0]?.[0];
    const savedArg = savedArgs?.[0];
    expect(savedArg?.notes).toBe("beach");
  });

  it("reports a UID miss without saving", async () => {
    kh.seed({ menus: [], menuItems: [], mealTypes: [DINNER_TYPE] });

    const result = await kh.callTool("update_menu", { lookup: { uid: "ghost" }, name: "X" });
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(
      'No menu found with UID "ghost" (it may not exist or was already deleted). Use list_menus to find it.',
    );
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("disambiguates when a name matches multiple menus", async () => {
    const a = makeMenu({ uid: "m-a" as MenuUid, name: "Summer Plan A" });
    const b = makeMenu({ uid: "m-b" as MenuUid, name: "Summer Plan B" });
    kh.seed({ menus: [a, b], menuItems: [], mealTypes: [DINNER_TYPE] });

    const result = await kh.callTool("update_menu", { lookup: { name: "summer" }, days: 3 });
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('Multiple menus match "summer"');
    expect(text).toContain("`m-a`");
    expect(text).toContain("`m-b`");
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("rejects a days-shrink that would orphan menuitems, naming the conflicts", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Big Plan", days: 5 });
    const day3 = makeMenuItem({ uid: "mi-3" as MenuItemUid, menuUid: "m-1", day: 3, name: "Soup" });
    const day5 = makeMenuItem({ uid: "mi-5" as MenuItemUid, menuUid: "m-1", day: 5, name: "Steak" });
    kh.seed({ menus: [menu], menuItems: [day3, day5], mealTypes: [DINNER_TYPE] });

    const text = await kh.callToolText("update_menu", { lookup: { uid: "m-1" }, days: 2 });

    expect(text).toContain("Cannot shrink");
    expect(text).toContain('"Soup" on day 3');
    expect(text).toContain('"Steak" on day 5');
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("allows a days-shrink that keeps every menuitem in range", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 5 });
    const day2 = makeMenuItem({ uid: "mi-2" as MenuItemUid, menuUid: "m-1", day: 2, name: "Soup" });
    kh.seed({ menus: [menu], menuItems: [day2], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenus).mockReturnValue(
      okAsync([makeMenu({ uid: "m-1" as MenuUid, name: "Plan", days: 3 })]),
    );

    await kh.callTool("update_menu", { lookup: { uid: "m-1" }, days: 3 });
    const savedArgs = vi.mocked(kh.client().saveMenus).mock.calls[0]?.[0];
    const savedArg = savedArgs?.[0];
    expect(savedArg?.days).toBe(3);
  });
});

describe("delete_menu tool", () => {
  const kh = useKernelHarness<MenuState>("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    // DO NOT seed menus/menuItems/mealTypes — stores stay cold
    const text = await kh.callToolText("delete_menu", { lookup: { uid: "m-1" } });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("deletes an empty menu (no menuitems) and removes the menu from the store", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Empty" });
    kh.seed({ menus: [menu], menuItems: [], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenus).mockReturnValue(okAsync([{ ...menu, deleted: true }]));

    const text = await kh.callToolText("delete_menu", { lookup: { uid: "m-1" } });

    expect(text).toContain('Menu "Empty" has been deleted.');
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
    expect(kh.client().saveMenus).toHaveBeenCalledOnce();
    const savedArgs = vi.mocked(kh.client().saveMenus).mock.calls[0]?.[0];
    expect(savedArgs?.[0]?.deleted).toBe(true);
    expect(kh.state().menus.store.get("m-1" as MenuUid)).toBeUndefined();
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("cascades the tombstone to every menuitem before tombstoning the menu", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday" });
    const item1 = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", name: "Turkey" });
    const item2 = makeMenuItem({ uid: "mi-2" as MenuItemUid, menuUid: "m-1", name: "Pie" });
    kh.seed({ menus: [menu], menuItems: [item1, item2], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation((items) =>
      okAsync(items.map((i) => ({ ...i, deleted: true, menuUid: null }))),
    );
    vi.mocked(kh.client().saveMenus).mockReturnValue(okAsync([{ ...menu, deleted: true }]));

    const text = await kh.callToolText("delete_menu", { lookup: { uid: "m-1" } });

    expect(text).toContain('Menu "Holiday" and its 2 planned recipe(s) has been deleted.');

    // children tombstoned in one batch, all with deleted: true
    expect(kh.client().saveMenuItems).toHaveBeenCalledOnce();
    const savedItems = vi.mocked(kh.client().saveMenuItems).mock.calls[0]?.[0];
    expect(savedItems).toHaveLength(2);
    expect(savedItems?.every((i) => i.deleted)).toBe(true);
    // cascade tombstones null the back-reference, matching the wire capture
    expect(savedItems?.every((i) => i.menuUid === null)).toBe(true);

    // parent tombstoned after
    expect(kh.client().saveMenus).toHaveBeenCalledOnce();
    expect(vi.mocked(kh.client().saveMenus).mock.calls[0]?.[0]?.[0]?.deleted).toBe(true);

    // children invocation ordered before the parent invocation
    const itemsOrder = vi.mocked(kh.client().saveMenuItems).mock.invocationCallOrder[0]!;
    const menusOrder = vi.mocked(kh.client().saveMenus).mock.invocationCallOrder[0]!;
    expect(itemsOrder).toBeLessThan(menusOrder);

    // stores reflect the cascade
    expect(kh.state().items.store.getByMenuUid("m-1" as MenuUid)).toHaveLength(0);
    expect(kh.state().menus.store.get("m-1" as MenuUid)).toBeUndefined();
  });

  it("declining the confirm cancels without writing", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday" });
    const item1 = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", name: "Turkey" });
    kh.seed({ menus: [menu], menuItems: [item1], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenuItems).mockImplementation((items) =>
      okAsync(items.map((i) => ({ ...i, deleted: true, menuUid: null }))),
    );
    vi.mocked(kh.client().saveMenus).mockReturnValue(okAsync([{ ...menu, deleted: true }]));
    kh.setElicitResponder(() => ({ action: "decline" }));

    const text = await kh.callToolText("delete_menu", { lookup: { uid: "m-1" } });

    expect(text).toContain("Cancelled");
    expect(kh.client().saveMenuItems).not.toHaveBeenCalled();
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("reports a UID miss without saving", async () => {
    kh.seed({ menus: [], menuItems: [], mealTypes: [DINNER_TYPE] });

    const result = await kh.callTool("delete_menu", { lookup: { uid: "ghost" } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(
      'No menu found with UID "ghost" (it may not exist or was already deleted). Use list_menus to find it.',
    );
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("disambiguates a name that matches multiple menus without deleting", async () => {
    const a = makeMenu({ uid: "m-a" as MenuUid, name: "Weekly Plan A" });
    const b = makeMenu({ uid: "m-b" as MenuUid, name: "Weekly Plan B" });
    kh.seed({ menus: [a, b], menuItems: [], mealTypes: [DINNER_TYPE] });

    const result = await kh.callTool("delete_menu", { lookup: { name: "weekly" } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('Multiple menus match "weekly"');
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });

  it("does not tombstone the menu when the cascade item save fails", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday" });
    const item = makeMenuItem({ uid: "mi-1" as MenuItemUid, menuUid: "m-1", name: "Turkey" });
    kh.seed({ menus: [menu], menuItems: [item], mealTypes: [DINNER_TYPE] });
    vi.mocked(kh.client().saveMenuItems).mockReturnValueOnce(errAsync(new Error("network down")));

    const text = await kh.callToolText("delete_menu", { lookup: { uid: "m-1" } });

    expect(text).toContain("Failed to delete the recipes");
    expect(text).toContain("The menu was NOT deleted");
    expect(kh.client().saveMenus).not.toHaveBeenCalled();
  });
});
