import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { toolResult } from "../../../shared/tools.js";
import { PantryItemUidSchema } from "../ids.js";
import { pantryStartGuard } from "./guards.js";

// Structured-output payload (ADR-0019, R1): one row per pantry item, carrying the
// `uid` (read_pantry_item / update / delete / mark-out-of-stock / restock consume)
// plus the displayed fields. The "" sentinels for an absent quantity/aisle are
// normalized to null so "no aisle" reads unambiguously.
export const listPantryItemsOutputSchema = z.object({
  items: z.array(
    z.object({
      uid: PantryItemUidSchema,
      ingredient: z.string(),
      quantity: z.string().nullable(),
      aisle: z.string().nullable().describe("Aisle name, or null if unassigned."),
      inStock: z.boolean(),
      expirationDate: z.string().nullable(),
    }),
  ),
});

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

      const items = all.map((item) => ({
        uid: item.uid,
        ingredient: item.ingredient,
        quantity: item.quantity !== "" ? item.quantity : null,
        aisle: item.aisle !== "" ? item.aisle : null,
        inStock: item.inStock,
        expirationDate: item.expirationDate,
      }));
      const header = `You have ${total.toString()} pantry item${total === 1 ? "" : "s"}:\n`;
      const lines = all.map((item) => {
        const qty = item.quantity !== "" ? ` (${item.quantity})` : "";
        const aisle = item.aisle !== "" ? ` — ${item.aisle}` : "";
        const status = item.inStock ? "" : " · **out of stock**";
        const expires = item.expirationDate !== null ? ` · expires ${item.expirationDate}` : "";
        return `- **${item.ingredient}**${qty}${aisle}${status}${expires} (uid: \`${item.uid}\`)`;
      });

      return toolResult(header + "\n" + lines.join("\n"), { items });
    };
  },
);
