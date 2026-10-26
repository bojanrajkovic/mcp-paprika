import { describe, expect, it } from "vitest";

import type { MealTypeUid } from "../meal-type/ids.js";
import type { RecipeUid } from "../recipe/ids.js";
import type { RecipeRow } from "../recipe/recipe-helpers.js";
import type { Recipe } from "../recipe/types.js";
import type { MenuItemUid, MenuUid } from "./ids.js";

import { makeMealType } from "../../../test/domains/meal-type/__fixtures__/meal-types.js";
import { makeMenu, makeMenuItem } from "../../../test/domains/menu/__fixtures__/menus.js";
import { makeRecipe } from "../../../test/domains/recipe/__fixtures__/recipes.js";
import { recipeToRow } from "../recipe/recipe-helpers.js";
import { menuToReadStructured, resolveRecipeRows } from "./menu-helpers.js";

// No recipe metadata to denormalize unless a test supplies it; the name-only structured
// tests pass this through unchanged (rows resolve recipe: null).
const NO_RECIPES = new Map<RecipeUid, RecipeRow>();

const breakfast = makeMealType({
  uid: "breakfast-uid" as MealTypeUid,
  name: "Breakfast",
  orderFlag: 0,
  originalType: 0,
});
const dinner = makeMealType({ uid: "dinner-uid" as MealTypeUid, name: "Dinner", orderFlag: 2, originalType: 2 });

describe("menu-helpers", () => {
  it("menuToReadStructured carries each item's menuitem + recipe UID + resolved type name (B1/#321)", () => {
    const menu = makeMenu({ uid: "m-8" as MenuUid, name: "Plan", days: 1, notes: "" });
    const item = makeMenuItem({
      uid: "mi-8" as MenuItemUid,
      menuUid: "m-8",
      day: 1,
      typeUid: "dinner-uid",
      name: "Curry",
      recipeUid: "recipe-xyz",
    });
    const structured = menuToReadStructured(menu, [item], [dinner], NO_RECIPES);
    expect(structured).toMatchObject({ uid: "m-8", name: "Plan", days: 1, notes: "" });
    expect(structured.items).toEqual([
      {
        uid: "mi-8",
        day: 1,
        name: "Curry",
        typeUid: "dinner-uid",
        typeName: "Dinner",
        recipeUid: "recipe-xyz",
        // recipe-xyz isn't in the supplied map (not resolved), so the row stays name-only.
        recipe: null,
      },
    ]);
  });

  it("denormalizes the linked recipe's metadata onto the row when present", () => {
    const menu = makeMenu({ uid: "m-rich" as MenuUid, days: 1 });
    const item = makeMenuItem({
      uid: "mi-rich" as MenuItemUid,
      menuUid: "m-rich",
      day: 1,
      typeUid: "dinner-uid",
      name: "Pot Roast",
      recipeUid: "r-1",
    });
    const row = recipeToRow(makeRecipe({ uid: "r-1" as RecipeUid, rating: 4, totalTime: "3 hr" }), []);
    const map = new Map<RecipeUid, RecipeRow>([["r-1" as RecipeUid, row]]);
    const [out] = menuToReadStructured(menu, [item], [dinner], map).items;
    expect(out?.recipe).toMatchObject({ uid: "r-1", rating: 4, totalTime: "3 hr" });
  });

  it("menuToReadStructured carries recipeUid: null for freeform and typeName: null for a dangling type (B1/#321)", () => {
    const menu = makeMenu({ uid: "m-9" as MenuUid, days: 1 });
    const freeform = makeMenuItem({
      uid: "mi-9" as MenuItemUid,
      menuUid: "m-9",
      day: 1,
      typeUid: "ghost-type",
      name: "Freeform Night",
      recipeUid: null,
    });
    const [row] = menuToReadStructured(menu, [freeform], [dinner], NO_RECIPES).items;
    expect(row).toMatchObject({ uid: "mi-9", recipeUid: null, typeUid: "ghost-type", typeName: null, recipe: null });
  });

  it("menuToReadStructured emits rows in display order — day, meal-type orderFlag, item orderFlag (B1/#321)", () => {
    const menu = makeMenu({ uid: "m-ord" as MenuUid, days: 2 });
    // Input deliberately scrambled vs. display order (the store hands items in insertion/sync order).
    const d2dinner = makeMenuItem({
      uid: "d2d" as MenuItemUid,
      menuUid: "m-ord",
      day: 2,
      typeUid: "dinner-uid",
      name: "D2 Dinner",
      orderFlag: 0,
    });
    const d1dinner = makeMenuItem({
      uid: "d1d" as MenuItemUid,
      menuUid: "m-ord",
      day: 1,
      typeUid: "dinner-uid",
      name: "D1 Dinner",
      orderFlag: 0,
    });
    const d1breakfast = makeMenuItem({
      uid: "d1b" as MenuItemUid,
      menuUid: "m-ord",
      day: 1,
      typeUid: "breakfast-uid",
      name: "D1 Breakfast",
      orderFlag: 0,
    });

    const rows = menuToReadStructured(menu, [d2dinner, d1dinner, d1breakfast], [breakfast, dinner], NO_RECIPES).items;

    // breakfast orderFlag 0 < dinner orderFlag 2; day 1 before day 2.
    expect(rows.map((r) => r.uid)).toEqual(["d1b", "d1d", "d2d"]);
  });

  it("menuToReadStructured sorts an unknown meal type last within its day, and same-type items by orderFlag", () => {
    const menu = makeMenu({ uid: "m-tie" as MenuUid, days: 1 });
    const item = (uid: string, typeUid: string, orderFlag: number) =>
      makeMenuItem({ uid: uid as MenuItemUid, menuUid: "m-tie", day: 1, typeUid, name: uid, orderFlag });
    // Scrambled input: a dangling type first, then two dinners out of orderFlag order.
    const ghost = item("ghost", "ghost-type", 0);
    const dinnerB = item("dinner-b", "dinner-uid", 2);
    const dinnerA = item("dinner-a", "dinner-uid", 1);
    const breakfastItem = item("breakfast", "breakfast-uid", 5);

    const rows = menuToReadStructured(
      menu,
      [ghost, dinnerB, dinnerA, breakfastItem],
      [breakfast, dinner],
      NO_RECIPES,
    ).items;

    expect(rows.map((r) => r.uid)).toEqual(["breakfast", "dinner-a", "dinner-b", "ghost"]);
  });

  it("resolveRecipeRows keys only the linked recipes present in the store (freeform + dangling drop out)", () => {
    const present = makeRecipe({ uid: "r-here" as RecipeUid, rating: 5 });
    const source = {
      get: (uid: RecipeUid): Recipe | undefined => (uid === present.uid ? present : undefined),
      toRows: (rs: ReadonlyArray<Recipe>): ReadonlyArray<RecipeRow> => rs.map((r) => recipeToRow(r, [])),
    };
    const items = [
      makeMenuItem({ menuUid: "m", recipeUid: "r-here" }), // present → resolved
      makeMenuItem({ menuUid: "m", recipeUid: "r-gone" }), // dangling → dropped
      makeMenuItem({ menuUid: "m", recipeUid: null }), // freeform → dropped
    ];
    const map = resolveRecipeRows(items, source);
    expect([...map.keys()]).toEqual(["r-here"]);
  });
});
