import type { GroceryIngredient } from "../../grocery-ingredient/types.js";
import type { GroceryIngredientUid } from "../../ids.js";

let groceryIngredientCounter = 0;

export function makeGroceryIngredient(overrides?: Partial<GroceryIngredient>): GroceryIngredient {
  groceryIngredientCounter += 1;
  const uid = `grocery-ingredient-${groceryIngredientCounter.toString()}` as GroceryIngredientUid;
  return {
    uid,
    name: `Test Ingredient ${groceryIngredientCounter.toString()}`,
    aisleUid: "aisle-1",
    deleted: false,
    ...overrides,
  };
}
