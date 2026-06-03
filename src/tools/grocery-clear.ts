import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ServerContext } from "../types/server-context.js";

import { GroceryListUidSchema } from "../ids.js";
import { toMessage } from "../utils/log.js";
import { commitGroceryItemsBatch, groceryStartGuard } from "./grocery-helpers.js";
import { textResult } from "./helpers.js";

export function registerClearPurchasedTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "clear_purchased_grocery_items" });
  server.registerTool(
    "clear_purchased_grocery_items",
    {
      description: "Clear all purchased items from a grocery list.",
      inputSchema: {
        listUid: GroceryListUidSchema.describe("Grocery list UID to clear purchased items from"),
      },
    },
    async (args) => {
      log.info({ tool: "clear_purchased_grocery_items", listUid: args.listUid }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const list = ctx.groceryListStore.get(args.listUid);
          if (!list) {
            return textResult(`No grocery list found with UID "${args.listUid}".`);
          }

          const purchased = ctx.groceryItemStore.getPurchasedByList(args.listUid);
          if (purchased.length === 0) {
            return textResult(`No purchased items to clear in list "${list.name}".`);
          }

          const trashed = purchased.map((item) => ({ ...item, deleted: true }));
          try {
            const saved = await ctx.client.saveGroceryItems(trashed);
            await commitGroceryItemsBatch(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, listUid: args.listUid }, "saveGroceryItems (clear_purchased_grocery_items) failed");
            return textResult(`Failed to clear purchased items from "${list.name}": ${message}`);
          }

          return textResult(`Cleared ${trashed.length.toString()} purchased item(s) from "${list.name}".`);
        },
        (guard) => guard,
      );
    },
  );
}

export function registerClearAllTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "clear_grocery_list" });
  server.registerTool(
    "clear_grocery_list",
    {
      description: "Clear all items from a grocery list.",
      inputSchema: {
        listUid: GroceryListUidSchema.describe("Grocery list UID to clear all items from"),
      },
    },
    async (args) => {
      log.info({ tool: "clear_grocery_list", listUid: args.listUid }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const list = ctx.groceryListStore.get(args.listUid);
          if (!list) {
            return textResult(`No grocery list found with UID "${args.listUid}".`);
          }

          const items = ctx.groceryItemStore.getByListUid(args.listUid);
          if (items.length === 0) {
            return textResult(`No items to clear in list "${list.name}".`);
          }

          const trashed = items.map((item) => ({ ...item, deleted: true }));
          try {
            const saved = await ctx.client.saveGroceryItems(trashed);
            await commitGroceryItemsBatch(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, listUid: args.listUid }, "saveGroceryItems (clear_grocery_list) failed");
            return textResult(`Failed to clear items from "${list.name}": ${message}`);
          }

          return textResult(`Cleared ${trashed.length.toString()} item(s) from "${list.name}".`);
        },
        (guard) => guard,
      );
    },
  );
}
