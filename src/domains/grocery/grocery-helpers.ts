import type { GroceryItem } from "./grocery-item/types.js";
import type { GroceryList } from "./grocery-list/types.js";

// Aisle display names resolve through the live catalog (`aisleNameOf`, built from
// `ctx.deps.aisle.get`), with the item's denormalized `aisle` copy as the fallback
// for dangling/no-aisle references. Items denormalize the name at write time, so
// after an aisle rename the copies go stale; resolving at render keeps every
// rendering current without cascade-rewriting items (the category pattern).

/**
 * Renders a grocery list as markdown with metadata and a table of items.
 */
export function groceryListToMarkdown(
  list: GroceryList,
  items: ReadonlyArray<GroceryItem>,
  aisleNameOf: (item: GroceryItem) => string,
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
      const aisleName = aisleNameOf(item);
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
export function groceryItemToMarkdown(item: GroceryItem, aisleNameOf: (item: GroceryItem) => string): string {
  const lines: Array<string> = [];
  lines.push(`# ${item.ingredient}`);
  lines.push("");
  lines.push(`**UID:** \`${item.uid}\``);
  lines.push(`**List:** \`${item.listUid}\``);
  if (item.quantity !== "") {
    lines.push(`**Quantity:** ${item.quantity}`);
  }
  const aisleName = aisleNameOf(item);
  if (aisleName !== "") {
    lines.push(`**Aisle:** ${aisleName}`);
  }
  lines.push(`**Purchased:** ${item.purchased ? "Yes" : "No"}`);
  if (item.instruction !== "") {
    lines.push(`**Notes:** ${item.instruction}`);
  }
  return lines.join("\n");
}
