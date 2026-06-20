import { z } from "zod";

import type { AisleNameSource } from "../aisle/display.js";
import type { AisleUid } from "../aisle/ids.js";
import type { GroceryItem } from "./grocery-item/types.js";
import type { GroceryList } from "./grocery-list/types.js";

import { aisleDisplayName } from "../aisle/display.js";
import { GroceryItemUidSchema, GroceryListUidSchema } from "./ids.js";

// Aisle display names resolve through the live catalog (`aisles` — the caller
// passes `ctx.deps.aisle`), with the item's denormalized copy as the fallback;
// the contract lives in `../aisle/display.ts`.

/**
 * The structured-output row for one grocery item (ADR-0019, R1, B1/#321) — the
 * machine-readable counterpart to the list table, and the C2 grocery-checklist
 * widget's per-row feed (#329/#332). `uid` drives the per-item tools
 * (`mark_grocery_item_purchased` / `update_grocery_item` / `delete_grocery_item` /
 * `move_grocery_items_to_pantry`); `aisle` is the live-catalog display name for
 * grouping (null when unassigned — matching `list_pantry_items`' "" → null
 * normalization). The raw aisle FK is deliberately omitted: the model groups by
 * name and the follow-up tools key on the item UID, not the aisle.
 */
export const groceryItemRowSchema = z.object({
  uid: GroceryItemUidSchema,
  ingredient: z.string(),
  quantity: z.string().nullable(),
  aisle: z.string().nullable().describe("Aisle display name, or null if unassigned."),
  purchased: z.boolean(),
});

export type GroceryItemRow = z.infer<typeof groceryItemRowSchema>;

/**
 * The structured-output payload for `read_grocery_list` / `create_grocery_list` /
 * `rename_grocery_list` — one shape per entity, so the model pattern-matches a list
 * the same way whether it read, created, or renamed it.
 */
export const groceryListReadOutputSchema = z.object({
  uid: GroceryListUidSchema,
  name: z.string(),
  items: z.array(groceryItemRowSchema),
});

export type GroceryListReadStructured = z.infer<typeof groceryListReadOutputSchema>;

/**
 * Map a `GroceryItem` into a {@link GroceryItemRow}, resolving its aisle name through
 * the live catalog (the same resolution {@link groceryListToMarkdown} uses, so the
 * text table and the structured row agree by construction).
 */
export function groceryItemToRow(item: GroceryItem, aisles: AisleNameSource): GroceryItemRow {
  const aisle = aisleDisplayName(aisles, item);
  return {
    uid: item.uid,
    ingredient: item.ingredient,
    quantity: item.quantity !== "" ? item.quantity : null,
    aisle: aisle !== "" ? aisle : null,
    purchased: item.purchased,
  };
}

export function groceryItemsToRows(items: ReadonlyArray<GroceryItem>, aisles: AisleNameSource): Array<GroceryItemRow> {
  return items.map((item) => groceryItemToRow(item, aisles));
}

/** The slice of the aisle catalog the checklist sort reads: each aisle's walk-order `orderFlag` and name. */
export interface AisleOrderSource {
  get(uid: AisleUid): { readonly orderFlag: number; readonly name: string } | undefined;
}

/**
 * Order grocery items into store-walk order for the checklist: by aisle `orderFlag`, then aisle
 * identity (name, then `aisleUid`), then the item's own `orderFlag`, then `uid` for a total, stable
 * order. The aisle tie-break before item order keeps one aisle's items contiguous even when two
 * aisles share an `orderFlag` (the catalog allows ties, breaking them by name) — without it an
 * A/B/A interleave would make the widget, which groups only consecutive same-aisle rows, render the
 * same aisle twice. Items with no/unknown aisle sort last (the widget's "Other" group). Pure and
 * deterministic, so `read_grocery_list`'s text table and its `structuredContent` agree by
 * construction. The aisle fields are reached through the live catalog contract (`ctx.deps.aisle.get`),
 * not the row — no new field rides the payload.
 */
export function sortGroceryItemsForChecklist(
  items: ReadonlyArray<GroceryItem>,
  aisleOrder: AisleOrderSource,
): Array<GroceryItem> {
  const aisle = (item: GroceryItem) => aisleOrder.get(item.aisleUid);
  const order = (item: GroceryItem): number => aisle(item)?.orderFlag ?? Number.MAX_SAFE_INTEGER;
  const aisleName = (item: GroceryItem): string => aisle(item)?.name ?? "";
  return [...items].sort(
    (a, b) =>
      order(a) - order(b) ||
      aisleName(a).localeCompare(aisleName(b)) ||
      a.aisleUid.localeCompare(b.aisleUid) ||
      a.orderFlag - b.orderFlag ||
      a.uid.localeCompare(b.uid),
  );
}

/** Map a `GroceryList` plus its items into the structured read payload. */
export function groceryListToStructured(
  list: GroceryList,
  items: ReadonlyArray<GroceryItem>,
  aisles: AisleNameSource,
): GroceryListReadStructured {
  return { uid: list.uid, name: list.name, items: groceryItemsToRows(items, aisles) };
}

/**
 * Renders a grocery list as markdown with metadata and a table of items. The
 * per-item UIDs travel on the structured channel ({@link groceryListToStructured},
 * ADR-0019 R1) — the human table stays clean. The `includeItemUids` per-renderer
 * UID-column flag was retired in B1 (#321, #353); the top-level list `**UID:**`
 * line is kept as a text fallback pending the reliable-channel decision (#367/#368).
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
