import type { MealTypeUid } from "../../../../src/domains/meal-type/ids.js";
import type { MenuItemUid, MenuUid } from "../../../../src/domains/menu/ids.js";
import type { MenuItem } from "../../../../src/domains/menu/menu-item/types.js";
import type { Menu } from "../../../../src/domains/menu/types.js";
import type { RecipeUid } from "../../../../src/domains/recipe/ids.js";

let menuCounter = 0;
let menuItemCounter = 0;

export function makeMenu(overrides?: Partial<Menu>): Menu {
  menuCounter += 1;
  const uid = (overrides?.uid ?? `menu-${menuCounter.toString()}`) as MenuUid;
  return {
    uid,
    name: `Test Menu ${menuCounter.toString()}`,
    days: 1,
    orderFlag: 0,
    notes: "",
    deleted: false,
    ...overrides,
  };
}

// FK overrides are loosened to plain strings and branded here (see meals.ts).
// The nullable FKs (menuUid, recipeUid) use `=== undefined` to preserve an
// explicit `null` override; `typeUid` is non-nullable, so `??` is correct.
type MenuItemOverrides = Partial<Omit<MenuItem, "menuUid" | "recipeUid" | "typeUid">> & {
  readonly menuUid?: string | null;
  readonly recipeUid?: string | null;
  readonly typeUid?: string;
};

export function makeMenuItem(overrides?: MenuItemOverrides): MenuItem {
  menuItemCounter += 1;
  const { menuUid, recipeUid, typeUid, ...rest } = overrides ?? {};
  return {
    uid: `menu-item-${menuItemCounter.toString()}` as MenuItemUid,
    menuUid: (menuUid === undefined ? "menu-1" : menuUid) as MenuUid | null,
    recipeUid: (recipeUid === undefined ? "recipe-1" : recipeUid) as RecipeUid | null,
    name: `Test Item ${menuItemCounter.toString()}`,
    day: 1,
    typeUid: (typeUid ?? "dinner-uid") as MealTypeUid,
    orderFlag: menuItemCounter - 1,
    deleted: false,
    ...rest,
  };
}

// Wire-format factories for MSW/API test fixtures (snake_case, no branding).
export function makeSnakeCaseMenu(uid: string, overrides?: Partial<Record<string, unknown>>): object {
  return {
    uid,
    name: `Menu ${uid}`,
    days: 1,
    order_flag: 0,
    notes: "",
    deleted: false,
    ...overrides,
  };
}

export function makeSnakeCaseMenuItem(uid: string, overrides?: Partial<Record<string, unknown>>): object {
  return {
    uid,
    menu_uid: "menu-1",
    recipe_uid: "recipe-1",
    name: `Item ${uid}`,
    day: 1,
    type_uid: "dinner-uid",
    order_flag: 0,
    deleted: false,
    ...overrides,
  };
}
