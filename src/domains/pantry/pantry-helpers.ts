import type { PantryItem } from "./types.js";

// notes is on PantryItem (the GET wire includes it) but no Paprika client
// exposes a UI for pantry notes and no captured item has a non-null value.
// Omitted from display and from POST payloads; retained in the schema so
// the parser doesn't reject the field if the server starts populating it.
// The aisle display name resolves through the live catalog (`aisleNameOf`, built
// from `ctx.deps.aisle.get`), falling back to the item's denormalized `aisle` copy
// for dangling/no-aisle references — see grocery-helpers.ts for the rationale.
export function pantryItemToMarkdown(item: PantryItem, aisleNameOf: (item: PantryItem) => string): string {
  const lines: Array<string> = [];

  lines.push(`# ${item.ingredient}`);
  lines.push("");
  lines.push(`**UID:** \`${item.uid}\``);

  if (item.quantity !== "") {
    lines.push(`**Quantity:** ${item.quantity}`);
  }
  const aisleName = aisleNameOf(item);
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
