import type { AisleNameSource } from "../aisle/display.js";
import type { GroceryItem } from "./grocery-item/types.js";
import type { GroceryList } from "./grocery-list/types.js";

import { aisleDisplayName } from "../aisle/display.js";

// Aisle display names resolve through the live catalog (`aisles` — the caller
// passes `ctx.deps.aisle`), with the item's denormalized copy as the fallback;
// the contract lives in `../aisle/display.ts` (ADR-0017 render-resolution).

/**
 * Renders a grocery list as markdown with metadata and a table of items.
 */
export function groceryListToMarkdown(
  list: GroceryList,
  items: ReadonlyArray<GroceryItem>,
  aisles: AisleNameSource,
): string {
  const lines: Array<string> = [];
  lines.push(`# ${list.name}`);
  lines.push("");
  lines.push(`**UID:** \`${list.uid}\``);
  lines.push(`**Items:** ${items.length.toString()}`);

  if (items.length > 0) {
    lines.push("");
    lines.push("| Ingredient | Qty | Aisle | Purchased |");
    lines.push("|------------|-----|-------|-----------|");
    for (const item of items) {
      const qty = item.quantity !== "" ? item.quantity : "—";
      const aisleName = aisleDisplayName(aisles, item);
      const aisle = aisleName !== "" ? aisleName : "—";
      const purchased = item.purchased ? "Yes" : "No";
      lines.push(`| ${item.ingredient} | ${qty} | ${aisle} | ${purchased} |`);
    }
  }

  return lines.join("\n");
}

/**
 * Renders a single grocery item as markdown with all available fields.
 */
export function groceryItemToMarkdown(item: GroceryItem, aisles: AisleNameSource): string {
  const lines: Array<string> = [];
  lines.push(`# ${item.ingredient}`);
  lines.push("");
  lines.push(`**UID:** \`${item.uid}\``);
  lines.push(`**List:** \`${item.listUid}\``);
  if (item.quantity !== "") {
    lines.push(`**Quantity:** ${item.quantity}`);
  }
  const aisleName = aisleDisplayName(aisles, item);
  if (aisleName !== "") {
    lines.push(`**Aisle:** ${aisleName}`);
  }
  lines.push(`**Purchased:** ${item.purchased ? "Yes" : "No"}`);
  if (item.instruction !== "") {
    lines.push(`**Notes:** ${item.instruction}`);
  }
  return lines.join("\n");
}
