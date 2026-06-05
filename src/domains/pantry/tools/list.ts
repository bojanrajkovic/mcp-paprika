import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { pantryStartGuard } from "./guards.js";

/**
 * `list_pantry_items` — list all pantry items. Pantry is a Data-class entity: no
 * resource surface (ADR-0004).
 */
export const listPantryItemsTool = defineTool(
  {
    name: "list_pantry_items",
    title: "List your pantry items",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "List all pantry items sorted alphabetically by ingredient name. Returns the ingredient, quantity, and aisle for each item. Use read_pantry_item with the UID for full details.",
    inputSchema: {},
  },
  (ctx: DomainCtx<PantryState, "aisle">) => {
    const log = ctx.infra.log.child({ component: "list_pantry_items" });
    return async () => {
      log.info({ tool: "list_pantry_items" }, "tool invoked");
      return pantryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const all = ctx.state.store.getAll().sort((a, b) => a.ingredient.localeCompare(b.ingredient));
          const total = all.length;

          if (total === 0) {
            return textResult("Your pantry is empty.");
          }

          const header = `You have ${total.toString()} pantry item${total === 1 ? "" : "s"}:\n`;
          const lines = all.map((item) => {
            const qty = item.quantity !== "" ? ` (${item.quantity})` : "";
            const aisle = item.aisle !== "" ? ` — ${item.aisle}` : "";
            const status = item.inStock ? "" : " · **out of stock**";
            const expires = item.expirationDate !== null ? ` · expires ${item.expirationDate}` : "";
            return `- **${item.ingredient}**${qty}${aisle}${status}${expires} (uid: \`${item.uid}\`)`;
          });

          return textResult(header + "\n" + lines.join("\n"));
        },
        (guard) => guard,
      );
    };
  },
);
