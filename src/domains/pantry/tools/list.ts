import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { structuredResult } from "../../../shared/tools.js";
import { listPantryItemsOutputSchema, pantryItemToRow } from "../pantry-helpers.js";
import { pantryStartGuard } from "./guards.js";

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
      const items = all.map((item) => pantryItemToRow(item, ctx.deps.aisle));
      return structuredResult({ items });
    };
  },
);
