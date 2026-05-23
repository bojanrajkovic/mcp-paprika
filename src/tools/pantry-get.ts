import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PantryItemUidSchema } from "../paprika/types.js";
import { pantryStartGuard, pantryItemToMarkdown } from "./pantry-helpers.js";
import { textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerGetPantryItemTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "get_pantry_item" });
  server.registerTool(
    "get_pantry_item",
    {
      description:
        "Get a pantry item by UID or ingredient name. When both are provided, UID takes precedence. " +
        "Ingredient lookup is fuzzy (exact → starts-with → contains) and case-insensitive. Returns " +
        "a disambiguation list when multiple items match the same tier.",
      inputSchema: {
        uid: z.string().optional().describe("Exact pantry item UID"),
        ingredient: z.string().optional().describe("Ingredient name (fuzzy match)"),
      },
    },
    async (args) => {
      log.info({ tool: "get_pantry_item", ...args }, "tool invoked");
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (!args.uid && !args.ingredient) {
            return textResult("Please provide either a uid or an ingredient name.");
          }

          if (args.uid) {
            const item = ctx.pantryStore.get(PantryItemUidSchema.parse(args.uid));
            if (!item) {
              return textResult(`No pantry item found with UID "${args.uid}".`);
            }
            return textResult(pantryItemToMarkdown(item));
          }

          // ingredient is truthy here (else branch of the uid check)
          const ingredient = args.ingredient!;
          const matches = ctx.pantryStore.findByIngredient(ingredient);

          if (matches.length === 0) {
            return textResult(`No pantry items found matching "${ingredient}".`);
          }

          if (matches.length === 1) {
            return textResult(pantryItemToMarkdown(matches[0]!));
          }

          const list = matches.map((item) => `- **${item.ingredient}** (uid: \`${item.uid}\`)`).join("\n");
          return textResult(
            `Multiple pantry items match "${ingredient}":\n${list}\n\nPlease re-invoke with a specific uid.`,
          );
        },
        (guard) => guard,
      );
    },
  );
}
