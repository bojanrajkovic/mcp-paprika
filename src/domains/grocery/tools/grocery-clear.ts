import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { GroceryListUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { groceryStartGuard } from "./guards.js";

/**
 * `clear_purchased_grocery_items` — batch soft-delete a list's purchased items.
 */
export const clearPurchasedTool = defineTool(
  {
    name: "clear_purchased_grocery_items",
    title: "Remove purchased items from a grocery list",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description: "Clear all purchased items from a grocery list.",
    inputSchema: {
      listUid: GroceryListUidSchema.describe("Grocery list UID to clear purchased items from"),
    },
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "clear_purchased_grocery_items" });
    return async (args) => {
      log.info({ tool: "clear_purchased_grocery_items", listUid: args.listUid }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const list = ctx.state.lists.store.get(args.listUid);
          if (!list) {
            return textResult(
              `No grocery list found with UID "${args.listUid}" (it may not exist or was already deleted).`,
            );
          }

          const purchased = ctx.state.items.store.getPurchasedByList(args.listUid);
          if (purchased.length === 0) {
            return textResult(`No purchased items to clear in list "${list.name}".`);
          }

          const trashed = purchased.map((item) => ({ ...item, deleted: true }));
          try {
            const saved = await ctx.infra.client.saveGroceryItems(trashed);
            await ctx.writes.commitGroceryItemsBatch(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, listUid: args.listUid }, "saveGroceryItems (clear_purchased_grocery_items) failed");
            return textResult(`Failed to clear purchased items from "${list.name}": ${message}`);
          }

          return textResult(`Cleared ${trashed.length.toString()} purchased item(s) from "${list.name}".`);
        },
        (guard) => guard,
      );
    };
  },
);

/**
 * `clear_grocery_list` — batch soft-delete ALL items in a grocery list.
 */
export const clearGroceryListTool = defineTool(
  {
    name: "clear_grocery_list",
    title: "Remove all items from a grocery list",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description: "Clear all items from a grocery list.",
    inputSchema: {
      listUid: GroceryListUidSchema.describe("Grocery list UID to clear all items from"),
    },
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "clear_grocery_list" });
    return async (args) => {
      log.info({ tool: "clear_grocery_list", listUid: args.listUid }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const list = ctx.state.lists.store.get(args.listUid);
          if (!list) {
            return textResult(
              `No grocery list found with UID "${args.listUid}" (it may not exist or was already deleted).`,
            );
          }

          const items = ctx.state.items.store.getByListUid(args.listUid);
          if (items.length === 0) {
            return textResult(`No items to clear in list "${list.name}".`);
          }

          const trashed = items.map((item) => ({ ...item, deleted: true }));
          try {
            const saved = await ctx.infra.client.saveGroceryItems(trashed);
            await ctx.writes.commitGroceryItemsBatch(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, listUid: args.listUid }, "saveGroceryItems (clear_grocery_list) failed");
            return textResult(`Failed to clear items from "${list.name}": ${message}`);
          }

          return textResult(`Cleared ${trashed.length.toString()} item(s) from "${list.name}".`);
        },
        (guard) => guard,
      );
    };
  },
);
