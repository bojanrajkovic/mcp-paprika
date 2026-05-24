import type { PantryItem, PantryItemUid } from "../../paprika/types.js";

let pantryItemCounter = 0;

export function makePantryItem(overrides?: Partial<PantryItem>): PantryItem {
  pantryItemCounter += 1;
  const uid = `pantry-${pantryItemCounter.toString()}` as PantryItemUid;
  return {
    uid,
    ingredient: `Test Ingredient ${pantryItemCounter.toString()}`,
    quantity: "1",
    aisle: "Produce",
    aisleUid: "aisle-1",
    expirationDate: null,
    hasExpiration: false,
    inStock: true,
    purchaseDate: "2026-01-01 00:00:00",
    notes: null,
    deleted: false,
    ...overrides,
  };
}
