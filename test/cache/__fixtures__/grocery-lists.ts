import type { GroceryList } from "../../../src/grocery-list/types.js";
import type { GroceryListUid } from "../../../src/ids.js";

let groceryListCounter = 0;

export function makeGroceryList(overrides?: Partial<GroceryList>): GroceryList {
  groceryListCounter += 1;
  const uid = `grocery-list-${groceryListCounter.toString()}` as GroceryListUid;
  return {
    uid,
    name: `Test List ${groceryListCounter.toString()}`,
    orderFlag: 0,
    isDefault: false,
    remindersList: "Paprika",
    deleted: false,
    ...overrides,
  };
}
