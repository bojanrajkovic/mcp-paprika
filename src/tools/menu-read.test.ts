import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeMenu, makeMenuItem } from "../cache/__fixtures__/menus.js";
import { makeMealType } from "../cache/__fixtures__/meals.js";
import { registerListMenusTool, registerReadMenuTool } from "./menu-read.js";
import { makeTestServer, makeCtx, getText, seed } from "./tool-test-utils.js";
import type { MealTypeUid, MenuItemUid, MenuUid } from "../paprika/types.js";

const BREAKFAST = makeMealType({
  uid: "breakfast-uid" as MealTypeUid,
  name: "Breakfast",
  orderFlag: 0,
  originalType: 0,
});
const DINNER = makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 });

function setup(opts: {
  menus: ReturnType<typeof makeMenu>[];
  items: ReturnType<typeof makeMenuItem>[];
  synced?: boolean;
}) {
  const { server, callTool } = makeTestServer();
  const ctx = makeCtx(new RecipeStore(), server);
  if (opts.synced ?? true) {
    seed(ctx, { menus: opts.menus, menuItems: opts.items, mealTypes: [BREAKFAST, DINNER] });
  }
  registerListMenusTool(server, ctx);
  registerReadMenuTool(server, ctx);
  return { callTool };
}

describe("list_menus tool", () => {
  it("blocks when stores are not synced", async () => {
    const { callTool } = setup({ menus: [], items: [], synced: false });
    const text = getText(await callTool("list_menus", {}));
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns an empty message when no menus exist", async () => {
    const { callTool } = setup({ menus: [], items: [] });
    const text = getText(await callTool("list_menus", {}));
    expect(text).toBe("No menus found.");
  });

  it("lists each menu with item count, day span, and UID", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 3 });
    const items = [makeMenuItem({ menuUid: "m-1", day: 1 }), makeMenuItem({ menuUid: "m-1", day: 2 })];
    const { callTool } = setup({ menus: [menu], items });
    const text = getText(await callTool("list_menus", {}));
    expect(text).toContain("- **Holiday** (2 items, 3 days) — `m-1`");
  });

  it("uses singular 'day' for a one-day menu", async () => {
    const menu = makeMenu({ uid: "m-2" as MenuUid, name: "Single", days: 1 });
    const { callTool } = setup({ menus: [menu], items: [] });
    const text = getText(await callTool("list_menus", {}));
    expect(text).toContain("(0 items, 1 day)");
  });

  it("sorts by orderFlag then name (Paprika order, not alphabetical)", async () => {
    const later = makeMenu({ uid: "m-z" as MenuUid, name: "Aardvark", orderFlag: 5 });
    const earlier = makeMenu({ uid: "m-a" as MenuUid, name: "Zucchini", orderFlag: 1 });
    const { callTool } = setup({ menus: [later, earlier], items: [] });
    const text = getText(await callTool("list_menus", {}));
    expect(text.indexOf("Zucchini")).toBeLessThan(text.indexOf("Aardvark"));
  });

  it("breaks orderFlag ties by name", async () => {
    const b = makeMenu({ uid: "m-b" as MenuUid, name: "Bravo", orderFlag: 0 });
    const a = makeMenu({ uid: "m-c" as MenuUid, name: "Alpha", orderFlag: 0 });
    const { callTool } = setup({ menus: [b, a], items: [] });
    const text = getText(await callTool("list_menus", {}));
    expect(text.indexOf("Alpha")).toBeLessThan(text.indexOf("Bravo"));
  });
});

describe("read_menu tool", () => {
  it("blocks when stores are not synced", async () => {
    const { callTool } = setup({ menus: [], items: [], synced: false });
    const text = getText(await callTool("read_menu", { lookup: { uid: "whatever" } }));
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("renders a menu by UID with its days and item lines carrying menuitem+recipe UIDs", async () => {
    const menu = makeMenu({ uid: "m-10" as MenuUid, name: "Dinner Week", days: 2 });
    const item = makeMenuItem({
      uid: "mi-10" as MenuItemUid,
      menuUid: "m-10",
      day: 1,
      typeUid: "dinner-uid",
      name: "Roast Chicken",
      recipeUid: "recipe-77",
    });
    const { callTool } = setup({ menus: [menu], items: [item] });
    const text = getText(await callTool("read_menu", { lookup: { uid: "m-10" } }));
    expect(text).toContain("# Dinner Week");
    expect(text).toContain("**Days:** 2");
    expect(text).toContain("- **Dinner:** Roast Chicken · item `mi-10` · recipe `recipe-77`");
    // Day 2 is empty
    expect(text).toContain("_(no meals planned)_");
  });

  it("resolves a menu by name (case-insensitive)", async () => {
    const menu = makeMenu({ uid: "m-11" as MenuUid, name: "Thanksgiving Dinner" });
    const { callTool } = setup({ menus: [menu], items: [] });
    const text = getText(await callTool("read_menu", { lookup: { name: "thanksgiving" } }));
    expect(text).toContain("# Thanksgiving Dinner");
  });

  it("reports no match for an unknown UID", async () => {
    const menu = makeMenu({ uid: "m-12" as MenuUid, name: "Present" });
    const { callTool } = setup({ menus: [menu], items: [] });
    const text = getText(await callTool("read_menu", { lookup: { uid: "missing" } }));
    expect(text).toContain('No menu found with UID "missing".');
  });

  it("reports no match for a name with no hits", async () => {
    const menu = makeMenu({ uid: "m-13" as MenuUid, name: "Present" });
    const { callTool } = setup({ menus: [menu], items: [] });
    const text = getText(await callTool("read_menu", { lookup: { name: "nonexistent" } }));
    expect(text).toContain('No menus found matching "nonexistent".');
  });

  it("disambiguates when multiple menus match the same tier", async () => {
    const a = makeMenu({ uid: "m-14" as MenuUid, name: "Summer Plan A" });
    const b = makeMenu({ uid: "m-15" as MenuUid, name: "Summer Plan B" });
    const { callTool } = setup({ menus: [a, b], items: [] });
    const text = getText(await callTool("read_menu", { lookup: { name: "summer" } }));
    expect(text).toContain('Multiple menus match "summer"');
    expect(text).toContain("`m-14`");
    expect(text).toContain("`m-15`");
  });
});
