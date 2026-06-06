import type { AisleUid } from "../../../../src/domains/aisle/ids.js";
import type { PantryItemUid } from "../../../../src/domains/pantry/ids.js";
import type { PantryItem } from "../../../../src/domains/pantry/types.js";

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
    ...overrides,
  };
}

type PantryItemOverrides = Partial<Omit<PantryItem, "aisleUid">> & { readonly aisleUid?: string };

export function makePantryItem(overrides?: PantryItemOverrides): PantryItem {
  pantryItemCounter += 1;
  const { aisleUid, ...rest } = overrides ?? {};
  return {
    uid: `pantry-${pantryItemCounter.toString()}` as PantryItemUid,
    ingredient: `Test Ingredient ${pantryItemCounter.toString()}`,
    quantity: "1",
    aisle: "Produce",
    aisleUid: (aisleUid ?? "aisle-1") as AisleUid,
    expirationDate: null,
    hasExpiration: false,
    inStock: true,
    purchaseDate: "2026-01-01 00:00:00",
    notes: null,
    deleted: false,
    ...rest,
  };
}
