import { z } from "zod";

import type { AisleDisplaySource } from "../aisle/api.js";
import type { PantryItem } from "./types.js";

import { PantryItemUidSchema } from "./ids.js";

/**
 * The six-field list row emitted by `list_pantry_items` — also the base shape
 * `pantryItemReadOutputSchema` extends. `aisle` is the live-catalog display name
 * (null when unassigned); `quantity` "" normalizes to null.
 */
export const pantryItemRowSchema = z.object({
  uid: PantryItemUidSchema,
  ingredient: z.string(),
  quantity: z.string().nullable(),
  aisle: z.string().nullable().describe("Aisle display name, or null if unassigned."),
  inStock: z.boolean(),
  expirationDate: z.string().nullable(),
});
export type PantryItemRow = z.infer<typeof pantryItemRowSchema>;

/**
 * Structured-output payload for `add_pantry_items` — a row per newly-added item
 * (the new UIDs the model chains `update_pantry_item` / `mark_pantry_item_out_of_stock`
 * / `restock_pantry_item` on). Shares {@link pantryItemRowSchema} with `list_pantry_items`.
 *
 * `skipped` carries the duplicate-skip notices verbatim — an item that duplicated an
 * existing ingredient (or an earlier batch entry) is not in `items`, and an existing
 * duplicate's UID + merge hint appear nowhere else in the payload, so the notice is the
 * model's only signal that the item was skipped rather than silently dropped. It is
 * optional because this schema is also `move_grocery_items_to_pantry`'s output, and a
 * move has no dedup step (it omits the field rather than sending an always-empty array).
 */
export const addPantryItemsOutputSchema = z.object({
  items: z.array(pantryItemRowSchema),
  skipped: z
    .array(z.string())
    .optional()
    .describe("Human-readable notices for items skipped as duplicates (add_pantry_items only); omitted when none."),
});

/**
 * The structured-output payload for `read_pantry_item` — the machine-readable
 * counterpart to the markdown, and the pantry-checklist widget feed.
 * `uid` drives `update_pantry_item` / `mark_pantry_item_out_of_stock` /
 * `restock_pantry_item` / `delete_pantry_item`. `aisle` is the live-catalog display name
 * (null when unassigned) and `quantity` "" normalizes to null — matching the
 * `list_pantry_items` row convention so the model pattern-matches one shape.
 */
export const pantryItemReadOutputSchema = pantryItemRowSchema.extend({
  purchaseDate: z.string().nullable(),
});

export type PantryItemReadStructured = z.infer<typeof pantryItemReadOutputSchema>;

/** Map a `PantryItem` into its list-row payload, resolving the aisle name through
 * the live catalog. */
export function pantryItemToRow(item: PantryItem, aisles: AisleDisplaySource): PantryItemRow {
  const aisle = aisles.displayName(item);
  return {
    uid: item.uid,
    ingredient: item.ingredient,
    quantity: item.quantity !== "" ? item.quantity : null,
    aisle: aisle !== "" ? aisle : null,
    inStock: item.inStock,
    expirationDate: item.expirationDate,
  };
}

/**
 * Map a `PantryItem` into its structured read payload, resolving the aisle name through
 * the live catalog. `notes` is on `PantryItem` (the GET wire includes it) but no Paprika
 * client exposes a UI for it and no captured item has a non-null value, so it is omitted
 * from display and POST payloads while retained in the schema.
 */
export function pantryItemToReadStructured(item: PantryItem, aisles: AisleDisplaySource): PantryItemReadStructured {
  return { ...pantryItemToRow(item, aisles), purchaseDate: item.purchaseDate };
}
