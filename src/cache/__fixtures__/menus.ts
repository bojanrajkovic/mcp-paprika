import type { Menu, MenuUid, MenuItem, MenuItemUid } from "../../paprika/types.js";

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

export function makeMenuItem(overrides?: Partial<MenuItem>): MenuItem {
  menuItemCounter += 1;
  const uid = (overrides?.uid ?? `menu-item-${menuItemCounter.toString()}`) as MenuItemUid;
  return {
    uid,
    menuUid: "menu-1",
    recipeUid: "recipe-1",
    name: `Test Item ${menuItemCounter.toString()}`,
    day: 1,
    typeUid: "dinner-uid",
    orderFlag: menuItemCounter - 1,
    deleted: false,
    ...overrides,
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
