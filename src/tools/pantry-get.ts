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
        "Get a pantry item by UID or ingredient name. Ingredient lookup is fuzzy " +
        "(exact → starts-with → contains) and case-insensitive, with a disambiguation list " +
        "when multiple items match the same tier. " +
        'Pass exactly one shape: {"uid": "..."} or {"ingredient": "..."}.',
      inputSchema: {
        lookup: z
          .union([
            z.object({ uid: z.string() }).strict().describe('Exact pantry item UID, e.g. {"uid": "..."}.'),
            z
              .object({ ingredient: z.string() })
              .strict()
              .describe('Ingredient name fuzzy match, e.g. {"ingredient": "Olive Oil"}.'),
          ])
          .describe('Pick exactly one shape: {"uid": "..."} or {"ingredient": "..."}.'),
      },
    },
    async (args) => {
      log.info({ tool: "get_pantry_item", ...args.lookup }, "tool invoked");
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if ("uid" in args.lookup) {
            const item = ctx.pantryStore.get(PantryItemUidSchema.parse(args.lookup.uid));
            if (!item) {
              return textResult(`No pantry item found with UID "${args.lookup.uid}".`);
            }
            return textResult(pantryItemToMarkdown(item));
          }

          const ingredient = args.lookup.ingredient;
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
