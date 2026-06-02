import type { GroceryItem } from "../../grocery-item/types.js";
import type { GroceryItemUid } from "../../ids.js";

let groceryItemCounter = 0;

export function makeGroceryItem(overrides?: Partial<GroceryItem>): GroceryItem {
  groceryItemCounter += 1;
  const uid = `grocery-item-${groceryItemCounter.toString()}` as GroceryItemUid;
  return {
    uid,
    name: `Test Ingredient ${groceryItemCounter.toString()}`,
    ingredient: `Test Ingredient ${groceryItemCounter.toString()}`,
    aisle: "Produce",
    aisleUid: "aisle-1",
    listUid: "list-1",
    purchased: false,
    deleted: false,
    orderFlag: 0,
    quantity: "",
    instruction: "",
    recipe: null,
    separate: false,
    ...overrides,
  };
}
