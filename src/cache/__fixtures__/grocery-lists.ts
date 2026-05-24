import type { GroceryList, GroceryListUid } from "../../paprika/types.js";

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
