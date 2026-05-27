import type { PantryItem, PantryItemUid } from "../../paprika/types.js";

let pantryItemCounter = 0;

/**
 * Produces a pantry item in the Paprika API snake_case wire format (pre-schema-transform).
 * Matches the real wire shape from GET /api/v2/sync/pantry/ including `location_uid`
 * (which PantryItemSchema currently drops).
 */
export function makeSnakeCasePantryItem(uid: string, overrides?: Partial<Record<string, unknown>>): object {
  return {
    uid,
    ingredient: `Item ${uid}`,
    quantity: "1",
    aisle: "",
    aisle_uid: "",
    expiration_date: null,
    has_expiration: false,
    in_stock: true,
    purchase_date: "2026-01-01 00:00:00",
    notes: null,
    location_uid: null,
    deleted: false,
    ...overrides,
  };
}

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
