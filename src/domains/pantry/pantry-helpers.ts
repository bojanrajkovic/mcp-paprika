import type { AisleNameSource } from "../aisle/display.js";
import type { PantryItem } from "./types.js";

import { aisleDisplayName } from "../aisle/display.js";

// notes is on PantryItem (the GET wire includes it) but no Paprika client
// exposes a UI for pantry notes and no captured item has a non-null value.
// Omitted from display and from POST payloads; retained in the schema so
// the parser doesn't reject the field if the server starts populating it.
// The aisle display name resolves through the live catalog (`aisles` — the
// caller passes `ctx.deps.aisle`); the fallback contract lives in
// `../aisle/display.ts` (ADR-0017 render-resolution).
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
