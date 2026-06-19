import type { AisleNameSource } from "../aisle/display.js";
import type { GroceryItem } from "./grocery-item/types.js";
import type { GroceryList } from "./grocery-list/types.js";

import { aisleDisplayName } from "../aisle/display.js";

// Aisle display names resolve through the live catalog (`aisles` — the caller
// passes `ctx.deps.aisle`), with the item's denormalized copy as the fallback;
// the contract lives in `../aisle/display.ts`.

/**
 * Renders a grocery list as markdown with metadata and a table of items.
 *
 * When `opts.includeItemUids` is set, the table carries a trailing `UID` column
 * so an agent can drive the per-item tools (`update_grocery_item`,
 * `delete_grocery_item`, `mark_grocery_item_purchased`, `move_grocery_items_to_pantry`)
 * — without it there is no way to reach an item's UID from the list. The
 * model-facing tools (`read_grocery_list` and the rename/create write tools that
 * echo the list back) pass `true`; the human-attachable resource passes `false`
 * for clean rows, matching the menu renderer's `includeItemUids` split.
 */
export function groceryListToMarkdown(
  list: GroceryList,
  items: ReadonlyArray<GroceryItem>,
  aisles: AisleNameSource,
  opts?: { readonly includeItemUids?: boolean },
): string {
  const includeItemUids = opts?.includeItemUids ?? false;

  const lines: Array<string> = [];
  lines.push(`# ${list.name}`);
  lines.push("");
  lines.push(`**UID:** \`${list.uid}\``);
  lines.push(`**Items:** ${items.length.toString()}`);

  if (items.length > 0) {
    lines.push("");
    lines.push(
      includeItemUids ? "| Ingredient | Qty | Aisle | Purchased | UID |" : "| Ingredient | Qty | Aisle | Purchased |",
    );
    lines.push(
      includeItemUids ? "|------------|-----|-------|-----------|-----|" : "|------------|-----|-------|-----------|",
    );
    for (const item of items) {
      const qty = item.quantity !== "" ? item.quantity : "—";
      const aisleName = aisleDisplayName(aisles, item);
      const aisle = aisleName !== "" ? aisleName : "—";
      const purchased = item.purchased ? "Yes" : "No";
      const row = `| ${item.ingredient} | ${qty} | ${aisle} | ${purchased} |`;
      lines.push(includeItemUids ? `${row} \`${item.uid}\` |` : row);
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
