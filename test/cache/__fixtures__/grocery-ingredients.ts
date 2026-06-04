import type { GroceryIngredient } from "../../../src/domains/grocery/grocery-ingredient/types.js";
import type { AisleUid, GroceryIngredientUid } from "../../../src/ids.js";

let groceryIngredientCounter = 0;

type GroceryIngredientOverrides = Partial<Omit<GroceryIngredient, "aisleUid">> & { readonly aisleUid?: string };

export function makeGroceryIngredient(overrides?: GroceryIngredientOverrides): GroceryIngredient {
  groceryIngredientCounter += 1;
  const { aisleUid, ...rest } = overrides ?? {};
  return {
    uid: `grocery-ingredient-${groceryIngredientCounter.toString()}` as GroceryIngredientUid,
    name: `Test Ingredient ${groceryIngredientCounter.toString()}`,
    aisleUid: (aisleUid ?? "aisle-1") as AisleUid,
    deleted: false,
    ...rest,
  };
}
