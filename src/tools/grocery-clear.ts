// pattern: Imperative Shell
import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GroceryListUidSchema } from "../paprika/types.js";
import { textResult } from "./helpers.js";
import { commitGroceryItem, groceryStartGuard } from "./grocery-helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerClearPurchasedTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "clear_purchased" });
  server.registerTool(
    "clear_purchased",
    {
      description:
        "Clear all purchased items from a grocery list via a single batch delete. " +
        "Returns an informational message if there are no purchased items to clear.",
      inputSchema: {
        listUid: z.string().min(1).describe("Grocery list UID to clear purchased items from"),
      },
    },
    async (args) => {
      log.info({ tool: "clear_purchased", listUid: args.listUid }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = GroceryListUidSchema.parse(args.listUid);
          const list = ctx.groceryListStore.get(uid);
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
            for (const s of saved) {
              await commitGroceryItem(ctx, s);
            }
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, listUid: args.listUid }, "saveGroceryItems (clear_purchased) failed");
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
  const log = ctx.log.child({ component: "clear_all" });
  server.registerTool(
    "clear_all",
    {
      description:
        "Clear all items from a grocery list via a single batch delete. " +
        "Returns an informational message if the list is already empty.",
      inputSchema: {
        listUid: z.string().min(1).describe("Grocery list UID to clear all items from"),
      },
    },
    async (args) => {
      log.info({ tool: "clear_all", listUid: args.listUid }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = GroceryListUidSchema.parse(args.listUid);
          const list = ctx.groceryListStore.get(uid);
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
            for (const s of saved) {
              await commitGroceryItem(ctx, s);
            }
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, listUid: args.listUid }, "saveGroceryItems (clear_all) failed");
            return textResult(`Failed to clear items from "${list.name}": ${message}`);
          }

          return textResult(`Cleared ${trashed.length.toString()} item(s) from "${list.name}".`);
        },
        (guard) => guard,
      );
    },
  );
}
