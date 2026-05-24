import type { GroceryIngredient, GroceryIngredientUid } from "../../paprika/types.js";

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
