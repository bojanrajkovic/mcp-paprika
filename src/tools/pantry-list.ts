import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { pantryStartGuard } from "./pantry-helpers.js";
import { textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerListPantryTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "list_pantry",
    {
      description:
        "List all pantry items sorted alphabetically by ingredient name. Returns the ingredient, quantity, and aisle for each item. Use get_pantry_item with the UID for full details.",
      inputSchema: {},
    },
    async () => {
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
            return `- **${item.ingredient}**${qty}${aisle} (uid: \`${item.uid}\`)`;
          });

          return textResult(header + "\n" + lines.join("\n"));
        },
        (guard) => guard,
      );
    },
  );
}
