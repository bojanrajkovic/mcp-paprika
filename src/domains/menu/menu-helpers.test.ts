import { describe, expect, it } from "vitest";

import type { MealTypeUid } from "../meal-type/ids.js";
import type { MenuItemUid, MenuUid } from "./ids.js";

import { makeMealType } from "../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMenu, makeMenuItem } from "../../../test/domains/menu/__fixtures__/menus.js";
import { menuToMarkdown } from "./menu-helpers.js";

const breakfast = makeMealType({
  uid: "breakfast-uid" as MealTypeUid,
  name: "Breakfast",
  orderFlag: 0,
  originalType: 0,
});
const dinner = makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 });

describe("menuToMarkdown", () => {
  it("renders header with name, days, and notes when notes non-empty", () => {
    const menu = makeMenu({ uid: "m-1" as MenuUid, name: "Weeknight Plan", days: 2, notes: "low carb" });
    const md = menuToMarkdown(menu, [], [breakfast, dinner]);
    expect(md).toContain("# Weeknight Plan");
    expect(md).toContain("**UID:** `m-1`");
    expect(md).toContain("**Days:** 2");
    expect(md).toContain("**Notes:** low carb");
  });

  it("omits the Notes line when notes is empty", () => {
    const menu = makeMenu({ name: "No Notes", days: 1, notes: "" });
    const md = menuToMarkdown(menu, [], [dinner]);
    expect(md).not.toContain("**Notes:**");
  });

  it("renders the full day span with explicit empty days", () => {
    const menu = makeMenu({ uid: "m-2" as MenuUid, days: 3 });
    const item = makeMenuItem({ menuUid: "m-2", day: 2, typeUid: "dinner-uid", name: "Chili" });
    const md = menuToMarkdown(menu, [item], [dinner]);
    expect(md).toContain("## Day 1");
    expect(md).toContain("## Day 2");
    expect(md).toContain("## Day 3");
    // Day 1 and Day 3 have no items
    const day1Block = md.slice(md.indexOf("## Day 1"), md.indexOf("## Day 2"));
    const day3Block = md.slice(md.indexOf("## Day 3"));
    expect(day1Block).toContain("_(no meals planned)_");
    expect(day3Block).toContain("_(no meals planned)_");
    // Day 2 has Chili
    const day2Block = md.slice(md.indexOf("## Day 2"), md.indexOf("## Day 3"));
    expect(day2Block).toContain("Chili");
    expect(day2Block).not.toContain("_(no meals planned)_");
  });

  it("sorts items within a day by meal-type orderFlag then item orderFlag", () => {
    const menu = makeMenu({ uid: "m-3" as MenuUid, days: 1 });
    // Add dinner before breakfast in input; dinner orderFlag (2) > breakfast (0)
    const dinnerItem = makeMenuItem({ menuUid: "m-3", day: 1, typeUid: "dinner-uid", name: "Steak", orderFlag: 0 });
    const breakfastItem = makeMenuItem({
      menuUid: "m-3",
      day: 1,
      typeUid: "breakfast-uid",
      name: "Pancakes",
      orderFlag: 0,
    });
    const md = menuToMarkdown(menu, [dinnerItem, breakfastItem], [breakfast, dinner]);
    expect(md.indexOf("Pancakes")).toBeLessThan(md.indexOf("Steak"));
  });

  it("sorts within the same meal type by item orderFlag", () => {
    const menu = makeMenu({ uid: "m-4" as MenuUid, days: 1 });
    const second = makeMenuItem({ menuUid: "m-4", day: 1, typeUid: "dinner-uid", name: "Dessert", orderFlag: 1 });
    const first = makeMenuItem({ menuUid: "m-4", day: 1, typeUid: "dinner-uid", name: "Main", orderFlag: 0 });
    const md = menuToMarkdown(menu, [second, first], [dinner]);
    expect(md.indexOf("Main")).toBeLessThan(md.indexOf("Dessert"));
  });

  it("sorts an unknown typeUid last within a day", () => {
    const menu = makeMenu({ uid: "m-5" as MenuUid, days: 1 });
    const unknown = makeMenuItem({ menuUid: "m-5", day: 1, typeUid: "ghost-type", name: "Mystery", orderFlag: 0 });
    const known = makeMenuItem({ menuUid: "m-5", day: 1, typeUid: "dinner-uid", name: "Roast", orderFlag: 0 });
    const md = menuToMarkdown(menu, [unknown, known], [dinner]);
    expect(md.indexOf("Roast")).toBeLessThan(md.indexOf("Mystery"));
  });

  it("renders the meal-type name and recipe name on each item line", () => {
    const menu = makeMenu({ uid: "m-6" as MenuUid, days: 1 });
    const item = makeMenuItem({ menuUid: "m-6", day: 1, typeUid: "dinner-uid", name: "Lasagna" });
    const md = menuToMarkdown(menu, [item], [dinner]);
    expect(md).toContain("- **Dinner:** Lasagna");
  });

  it("omits the type prefix for a dangling typeUid (deleted type), never the raw UID", () => {
    const menu = makeMenu({ uid: "m-7" as MenuUid, days: 1 });
    const item = makeMenuItem({ menuUid: "m-7", day: 1, typeUid: "ghost-type", name: "Soup" });
    const md = menuToMarkdown(menu, [item], [dinner]);
    expect(md).toContain("- Soup");
    expect(md).not.toContain("ghost-type:");
  });

  it("appends item and recipe UIDs when includeItemUids is set", () => {
    const menu = makeMenu({ uid: "m-8" as MenuUid, days: 1 });
    const item = makeMenuItem({
      uid: "mi-8" as MenuItemUid,
      menuUid: "m-8",
      day: 1,
      typeUid: "dinner-uid",
      name: "Curry",
      recipeUid: "recipe-xyz",
    });
    const md = menuToMarkdown(menu, [item], [dinner], { includeItemUids: true });
    expect(md).toContain("- **Dinner:** Curry · item `mi-8` · recipe `recipe-xyz`");
  });

  it("omits the recipe clause when recipeUid is null even with includeItemUids", () => {
    const menu = makeMenu({ uid: "m-9" as MenuUid, days: 1 });
    const item = makeMenuItem({
      uid: "mi-9" as MenuItemUid,
      menuUid: "m-9",
      day: 1,
      typeUid: "dinner-uid",
      name: "Freeform Night",
      recipeUid: null,
    });
    const md = menuToMarkdown(menu, [item], [dinner], { includeItemUids: true });
    expect(md).toContain("- **Dinner:** Freeform Night · item `mi-9`");
    expect(md).not.toContain("· recipe");
  });

  it("omits all UIDs by default (includeItemUids false)", () => {
    const menu = makeMenu({ uid: "m-10" as MenuUid, days: 1 });
    const item = makeMenuItem({
      uid: "mi-10" as MenuItemUid,
      menuUid: "m-10",
      day: 1,
      typeUid: "dinner-uid",
      name: "Plain",
      recipeUid: "recipe-1",
    });
    const md = menuToMarkdown(menu, [item], [dinner]);
    expect(md).toContain("- **Dinner:** Plain");
    expect(md).not.toContain("· item");
    expect(md).not.toContain("· recipe");
  });
});
