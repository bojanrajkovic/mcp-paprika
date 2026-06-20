import { z } from "zod";

import type { AisleNameSource } from "../aisle/display.js";
import type { PantryItem } from "./types.js";

import { aisleDisplayName } from "../aisle/display.js";
import { PantryItemUidSchema } from "./ids.js";

/**
 * The structured-output payload for `read_pantry_item` (ADR-0019, R1, B1/#321) — the
 * machine-readable counterpart to the markdown, and the C3 pantry-checklist widget feed
 * (#334). `uid` drives `update_pantry_item` / `mark_pantry_item_out_of_stock` /
 * `restock_pantry_item` / `delete_pantry_item`. `aisle` is the live-catalog display name
 * (null when unassigned) and `quantity` "" normalizes to null — matching the
 * `list_pantry_items` row convention so the model pattern-matches one shape.
 */
export const pantryItemReadOutputSchema = z.object({
  uid: PantryItemUidSchema,
  ingredient: z.string(),
  quantity: z.string().nullable(),
  aisle: z.string().nullable().describe("Aisle display name, or null if unassigned."),
  inStock: z.boolean(),
  expirationDate: z.string().nullable(),
  purchaseDate: z.string().nullable(),
});

export type PantryItemReadStructured = z.infer<typeof pantryItemReadOutputSchema>;

/** Map a `PantryItem` into its structured read payload, resolving the aisle name through
 * the live catalog (the same resolution {@link pantryItemToMarkdown} uses). */
export function pantryItemToStructured(item: PantryItem, aisles: AisleNameSource): PantryItemReadStructured {
  const aisle = aisleDisplayName(aisles, item);
  return {
    uid: item.uid,
    ingredient: item.ingredient,
    quantity: item.quantity !== "" ? item.quantity : null,
    aisle: aisle !== "" ? aisle : null,
    inStock: item.inStock,
    expirationDate: item.expirationDate,
    purchaseDate: item.purchaseDate,
  };
}

// notes is on PantryItem (the GET wire includes it) but no Paprika client
// exposes a UI for pantry notes and no captured item has a non-null value.
// Omitted from display and from POST payloads; retained in the schema so
// the parser doesn't reject the field if the server starts populating it.
// The aisle display name resolves through the live catalog (`aisles` — the
// caller passes `ctx.deps.aisle`); the fallback contract lives in
// `../aisle/display.ts`.
export function pantryItemToMarkdown(item: PantryItem, aisles: AisleNameSource): string {
  const lines: Array<string> = [];

  lines.push(`# ${item.ingredient}`);
  lines.push("");
  lines.push(`**UID:** \`${item.uid}\``);

  if (item.quantity !== "") {
    lines.push(`**Quantity:** ${item.quantity}`);
  }
  const aisleName = aisleDisplayName(aisles, item);
  if (aisleName !== "") {
    lines.push(`**Aisle:** ${aisleName}`);
  }
  lines.push(`**In stock:** ${item.inStock ? "Yes" : "No"}`);
  if (item.expirationDate !== null) {
    lines.push(`**Expires:** ${item.expirationDate}`);
  }
  if (item.purchaseDate !== null) {
    lines.push(`**Purchased:** ${item.purchaseDate}`);
  }
  return lines.join("\n");
}
