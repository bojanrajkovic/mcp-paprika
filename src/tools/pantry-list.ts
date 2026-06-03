import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ServerContext } from "../types/server-context.js";

import { textResult } from "./helpers.js";
import { pantryStartGuard } from "./pantry-helpers.js";

export function registerListPantryTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "list_pantry_items" });
  server.registerTool(
    "list_pantry_items",
    {
      annotations: { readOnlyHint: true, idempotentHint: true },
      description:
        "List all pantry items sorted alphabetically by ingredient name. Returns the ingredient, quantity, and aisle for each item. Use read_pantry_item with the UID for full details.",
      inputSchema: {},
    },
    async () => {
      log.info({ tool: "list_pantry_items" }, "tool invoked");
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const all = ctx.pantryStore.getAll().sort((a, b) => a.ingredient.localeCompare(b.ingredient));
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
    },
  );
}
