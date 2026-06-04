import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryList } from "../grocery-list/types.js";

/**
 * Renders a grocery list as markdown with metadata and a table of items.
 */
export function groceryListToMarkdown(list: GroceryList, items: ReadonlyArray<GroceryItem>): string {
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
      const aisle = item.aisle !== "" ? item.aisle : "—";
      const purchased = item.purchased ? "Yes" : "No";
      lines.push(`| ${item.ingredient} | ${qty} | ${aisle} | ${purchased} |`);
    }
  }

  return lines.join("\n");
}

/**
 * Renders a single grocery item as markdown with all available fields.
 */
export function groceryItemToMarkdown(item: GroceryItem): string {
  const lines: Array<string> = [];
  lines.push(`# ${item.ingredient}`);
  lines.push("");
  lines.push(`**UID:** \`${item.uid}\``);
  lines.push(`**List:** \`${item.listUid}\``);
  if (item.quantity !== "") {
    lines.push(`**Quantity:** ${item.quantity}`);
  }
  if (item.aisle !== "") {
    lines.push(`**Aisle:** ${item.aisle}`);
  }
  lines.push(`**Purchased:** ${item.purchased ? "Yes" : "No"}`);
  if (item.instruction !== "") {
    lines.push(`**Notes:** ${item.instruction}`);
  }
  return lines.join("\n");
}
