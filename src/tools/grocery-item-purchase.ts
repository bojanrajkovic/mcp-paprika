import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { GroceryItem } from "../grocery-item/types.js";
import type { ServerContext } from "../types/server-context.js";

import { GroceryItemUidSchema } from "../ids.js";
import { toMessage } from "../utils/log.js";
import { commitGroceryItem, groceryItemToMarkdown, groceryStartGuard } from "./grocery-helpers.js";
import { textResult } from "./helpers.js";

export const markGroceryItemPurchasedInputSchema = z
  .object({
    uid: GroceryItemUidSchema.describe("UID of the grocery item to mark purchased"),
  })
  .strict();

export function registerMarkGroceryItemPurchasedTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "mark_grocery_item_purchased" });
  server.registerTool(
    "mark_grocery_item_purchased",
    {
      title: "Mark a grocery item purchased",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Mark a grocery item as purchased (checked off) by UID.",
      inputSchema: markGroceryItemPurchasedInputSchema,
    },
    async (args) => {
      log.info({ tool: "mark_grocery_item_purchased", uid: args.uid }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.groceryItemStore.get(args.uid);
          if (existing === undefined) {
            return textResult(`No grocery item found with UID "${args.uid}".`);
          }

          let saved: GroceryItem;
          try {
            const updated: GroceryItem = { ...existing, purchased: true };
            saved = (await ctx.client.saveGroceryItems([updated]))[0]!;
            await commitGroceryItem(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveGroceryItems failed");
            return textResult(`Failed to mark grocery item purchased: ${message}`);
          }

          return textResult(groceryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    },
  );
}
