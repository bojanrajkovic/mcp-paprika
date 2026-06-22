import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { toolResult } from "../../../shared/tools.js";
import { pantryItemRowSchema, pantryItemToRow } from "../pantry-helpers.js";
import { pantryStartGuard } from "./guards.js";

// Structured-output payload: one row per pantry item. Aisle resolves
// through the live catalog so list and read always agree, even after an aisle rename.
// The "" sentinels for absent quantity/aisle are normalized to null.
export const listPantryItemsOutputSchema = z.object({ items: z.array(pantryItemRowSchema) });

/**
 * `list_pantry_items` — list all pantry items. Pantry is a Data-class entity: no
 * resource surface.
 */
export const listPantryItemsTool = defineTool(
  {
    name: "list_pantry_items",
    title: "List your pantry items",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "List all pantry items sorted alphabetically by ingredient name. Returns the ingredient, quantity, and aisle for each item. Use read_pantry_item with the UID for full details.",
    inputSchema: {},
    outputSchema: listPantryItemsOutputSchema,
    // Hosts with the apps surface render this result as the pantry checklist widget; others
    // show the text/structured result unchanged.
    ui: { resourceUri: "ui://widget/pantry-checklist" },
  },
  [pantryStartGuard],
  (ctx: DomainCtx<PantryState, "aisle">) => {
    return async () => {
      const all = ctx.state.store.getAll().sort((a, b) => a.ingredient.localeCompare(b.ingredient));
      const total = all.length;

      if (total === 0) {
        return toolResult("Your pantry is empty.", { items: [] });
      }

      const items = all.map((item) => pantryItemToRow(item, ctx.deps.aisle));
      const header = `You have ${total.toString()} pantry item${total === 1 ? "" : "s"}:\n`;
      const lines = all.map((item) => {
        const qty = item.quantity !== "" ? ` (${item.quantity})` : "";
        const aisle = ctx.deps.aisle.displayName(item);
        const aisleStr = aisle !== "" ? ` — ${aisle}` : "";
        const status = item.inStock ? "" : " · **out of stock**";
        const expires = item.expirationDate !== null ? ` · expires ${item.expirationDate}` : "";
        return `- **${item.ingredient}**${qty}${aisleStr}${status}${expires} (uid: \`${item.uid}\`)`;
      });

      return toolResult(header + "\n" + lines.join("\n"), { items });
    };
  },
);
