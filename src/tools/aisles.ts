import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { ServerContext } from "../types/server-context.js";

import { aisleStartGuard } from "./aisle-helpers.js";
import { textResult } from "./helpers.js";

export function registerAislesTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "list_aisles" });
  server.registerTool(
    "list_aisles",
    {
      title: "List grocery aisles",
      annotations: { readOnlyHint: true, idempotentHint: true },
      description:
        "List all known aisles, sorted by order then name. " +
        "Includes the aisle UID needed for pantry and grocery item writes.",
      inputSchema: {},
    },
    async () => {
      log.info({ tool: "list_aisles" }, "tool invoked");
      return aisleStartGuard(ctx).match(
        () => {
          const aisles = ctx.aisleStore.getAll().sort((a, b) => {
            if (a.orderFlag !== b.orderFlag) return a.orderFlag - b.orderFlag;
            return a.name.localeCompare(b.name);
          });

          if (aisles.length === 0) {
            return textResult(
              "No aisles found. Aisles are created in the Paprika app or automatically when you add a pantry item with a new aisle name.",
            );
          }

          const lines = aisles.map((a) => `- **${a.name}** — \`${a.uid}\``);
          return textResult(lines.join("\n"));
        },
        (guard) => guard,
      );
    },
  );
}
