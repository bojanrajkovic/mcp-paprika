import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { MealTypeUid } from "../../meal-type/ids.js";
import type { RecipeUid } from "../../recipe/ids.js";
import type { MenuItemUid, MenuUid } from "../ids.js";

import { makeMealType } from "../../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMenu, makeMenuItem } from "../../../../test/domains/menu/__fixtures__/menus.js";
import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getJson, getText } from "../../../../test/support/tool-test-utils.js";

const BREAKFAST = makeMealType({
  uid: "breakfast-uid" as MealTypeUid,
  name: "Breakfast",
  orderFlag: 0,
  originalType: 0,
});
const DINNER = makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 });

describe("list_menus tool", () => {
  const kh = useKernelHarness("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("blocks when stores are not synced", async () => {
    // stores never seeded — hasSynced stays false
    const text = await kh.callToolText("list_menus", {});
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns an empty message when no menus exist", async () => {
    kh.seed({ menus: [], menuItems: [], mealTypes: [BREAKFAST, DINNER] });
    const json = await kh.callToolJson<{ items: unknown[] }>("list_menus", {});
    expect(json.items).toEqual([]);
  });

  it("lists each menu with item count, day span, and UID", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 3 });
    const items = [makeMenuItem({ menuUid: "m-1", day: 1 }), makeMenuItem({ menuUid: "m-1", day: 2 })];
    kh.seed({ menus: [menu], menuItems: items, mealTypes: [BREAKFAST, DINNER] });
    const json = await kh.callToolJson<{
      items: Array<{ uid: string; name: string; itemCount: number; days: number }>;
    }>("list_menus", {});
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toEqual({ uid: "m-1", name: "Holiday", itemCount: 2, days: 3 });
  });

  it("emits structured menu rows with uid, item count, and day span (R1)", async () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Holiday", days: 3 });
    const items = [makeMenuItem({ menuUid: "m-1", day: 1 }), makeMenuItem({ menuUid: "m-1", day: 2 })];
    kh.seed({ menus: [menu], menuItems: items, mealTypes: [BREAKFAST, DINNER] });
    const result = await kh.callTool("list_menus", {});
    expect(result.isError).toBeFalsy();
    const { items: rows } = result.structuredContent as { items: Array<Record<string, unknown>> };
    expect(rows).toEqual([{ uid: "m-1", name: "Holiday", itemCount: 2, days: 3 }]);
  });

  it("uses singular 'day' for a one-day menu", async () => {
    const menu = makeMenu({ uid: "m-2" as MenuUid, name: "Single", days: 1 });
    kh.seed({ menus: [menu], menuItems: [], mealTypes: [BREAKFAST, DINNER] });
    const json = await kh.callToolJson<{
      items: Array<{ uid: string; name: string; itemCount: number; days: number }>;
    }>("list_menus", {});
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toMatchObject({ name: "Single", itemCount: 0, days: 1 });
  });

  it("sorts by orderFlag then name (Paprika order, not alphabetical)", async () => {
    const later = makeMenu({ uid: "m-z" as MenuUid, name: "Aardvark", orderFlag: 5 });
    const earlier = makeMenu({ uid: "m-a" as MenuUid, name: "Zucchini", orderFlag: 1 });
    kh.seed({ menus: [later, earlier], menuItems: [], mealTypes: [BREAKFAST, DINNER] });
    const text = await kh.callToolText("list_menus", {});
    expect(text.indexOf("Zucchini")).toBeLessThan(text.indexOf("Aardvark"));
  });

  it("breaks orderFlag ties by name", async () => {
    const b = makeMenu({ uid: "m-b" as MenuUid, name: "Bravo", orderFlag: 0 });
    const a = makeMenu({ uid: "m-c" as MenuUid, name: "Alpha", orderFlag: 0 });
    kh.seed({ menus: [b, a], menuItems: [], mealTypes: [BREAKFAST, DINNER] });
    const text = await kh.callToolText("list_menus", {});
    expect(text.indexOf("Alpha")).toBeLessThan(text.indexOf("Bravo"));
  });
});

describe("read_menu tool", () => {
  const kh = useKernelHarness("menu");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("blocks when stores are not synced", async () => {
    // stores never seeded — hasSynced stays false
    const text = await kh.callToolText("read_menu", { lookup: { uid: "whatever" } });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("renders clean day lines; menuitem+recipe UIDs ride structuredContent (B1/#321)", async () => {
    const menu = makeMenu({ uid: "m-10" as MenuUid, name: "Dinner Week", days: 2 });
    const item = makeMenuItem({
      uid: "mi-10" as MenuItemUid,
      menuUid: "m-10",
      day: 1,
      typeUid: "dinner-uid",
      name: "Roast Chicken",
      recipeUid: "recipe-77",
    });
    kh.seed({ menus: [menu], menuItems: [item], mealTypes: [BREAKFAST, DINNER] });
    const result = await kh.callTool("read_menu", { lookup: { uid: "m-10" } });

    // The text is now compact JSON; assert on the parsed payload fields.
    const json = getJson<{ uid: string; name: string; days: number; items: Array<Record<string, unknown>> }>(result);
    expect(json.name).toBe("Dinner Week");
    expect(json.days).toBe(2);
    // The item is present with its UID (now in the text/JSON channel).
    expect(json.items).toHaveLength(1);
    expect(json.items[0]).toMatchObject({ uid: "mi-10", name: "Roast Chicken", typeName: "Dinner" });
    // The text (compact JSON) does not contain any "· item" markup fragment.
    expect(getText(result)).not.toContain("· item");

    // The UIDs the model chains on (update_menu_item / read_recipe) ride structuredContent.
    const structured = result.structuredContent as { uid: string; days: number; items: Array<Record<string, unknown>> };
    expect(structured).toMatchObject({ uid: "m-10", days: 2 });
    expect(structured.items).toEqual([
      {
        uid: "mi-10",
        day: 1,
        name: "Roast Chicken",
        typeUid: "dinner-uid",
        typeName: "Dinner",
        recipeUid: "recipe-77",
        // recipe-77 isn't seeded into the recipe store, so the link is dangling → name-only row.
        recipe: null,
      },
    ]);
  });

  it("denormalizes the linked recipe's metadata onto the row for rich widget rows", async () => {
    const menu = makeMenu({ uid: "m-rich" as MenuUid, name: "Rich Week", days: 1 });
    const item = makeMenuItem({
      uid: "mi-rich" as MenuItemUid,
      menuUid: "m-rich",
      day: 1,
      typeUid: "dinner-uid",
      name: "Pot Roast",
      recipeUid: "r-1",
    });
    const recipe = makeRecipe({ uid: "r-1" as RecipeUid, name: "Pot Roast", rating: 4, totalTime: "3 hr" });
    kh.seed({ recipes: [recipe], menus: [menu], menuItems: [item], mealTypes: [BREAKFAST, DINNER] });
    const result = await kh.callTool("read_menu", { lookup: { uid: "m-rich" } });

    const structured = result.structuredContent as { items: Array<{ recipe: Record<string, unknown> | null }> };
    expect(structured.items[0]?.recipe).toMatchObject({ uid: "r-1", rating: 4, totalTime: "3 hr" });
  });

  it("a not-found read carries no structuredContent (errorResult, B1/#321)", async () => {
    kh.seed({ menus: [makeMenu({ uid: "m-x" as MenuUid })], menuItems: [], mealTypes: [BREAKFAST, DINNER] });
    const result = await kh.callTool("read_menu", { lookup: { uid: "missing" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("resolves a menu by name (case-insensitive)", async () => {
    const menu = makeMenu({ uid: "m-11" as MenuUid, name: "Thanksgiving Dinner" });
    kh.seed({ menus: [menu], menuItems: [], mealTypes: [BREAKFAST, DINNER] });
    const json = await kh.callToolJson<{ name: string }>("read_menu", { lookup: { name: "thanksgiving" } });
    expect(json.name).toBe("Thanksgiving Dinner");
  });

  it("reports no match for an unknown UID", async () => {
    const menu = makeMenu({ uid: "m-12" as MenuUid, name: "Present" });
    kh.seed({ menus: [menu], menuItems: [], mealTypes: [BREAKFAST, DINNER] });
    const result = await kh.callTool("read_menu", { lookup: { uid: "missing" } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(
      'No menu found with UID "missing" (it may not exist or was already deleted). Use list_menus to find it.',
    );
  });

  it("reports no match for a name with no hits", async () => {
    const menu = makeMenu({ uid: "m-13" as MenuUid, name: "Present" });
    kh.seed({ menus: [menu], menuItems: [], mealTypes: [BREAKFAST, DINNER] });
    const result = await kh.callTool("read_menu", { lookup: { name: "nonexistent" } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('No menus found matching "nonexistent". Use list_menus to find it.');
  });

  it("disambiguates when multiple menus match the same tier", async () => {
    const a = makeMenu({ uid: "m-14" as MenuUid, name: "Summer Plan A" });
    const b = makeMenu({ uid: "m-15" as MenuUid, name: "Summer Plan B" });
    kh.seed({ menus: [a, b], menuItems: [], mealTypes: [BREAKFAST, DINNER] });
    const result = await kh.callTool("read_menu", { lookup: { name: "summer" } });
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain('Multiple menus match "summer"');
    expect(text).toContain("`m-14`");
    expect(text).toContain("`m-15`");
  });
});
