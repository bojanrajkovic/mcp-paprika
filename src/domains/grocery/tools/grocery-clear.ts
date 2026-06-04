import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GrocerySelf } from "../module.js";

import { GroceryListUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { groceryStartGuard } from "./guards.js";

/**
 * Registers `clear_purchased_grocery_items`, kernel-shaped — batch soft-delete of a
 * list's purchased items, writing through `ctx.self.commitGroceryItemsBatch`. Body
 * lifted verbatim from `src/tools/grocery-clear.ts`.
 */
export function clearPurchasedTool(ctx: DomainCtx<GrocerySelf, "aisle" | "pantry">): void {
  const log = ctx.infra.log.child({ component: "clear_purchased_grocery_items" });
  ctx.server.registerTool(
    "clear_purchased_grocery_items",
    {
      title: "Remove purchased items from a grocery list",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      description: "Clear all purchased items from a grocery list.",
      inputSchema: {
        listUid: GroceryListUidSchema.describe("Grocery list UID to clear purchased items from"),
      },
    },
    async (args) => {
      log.info({ tool: "clear_purchased_grocery_items", listUid: args.listUid }, "tool invoked");
      return groceryStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const list = ctx.self.lists.store.get(args.listUid);
          if (!list) {
            return textResult(`No grocery list found with UID "${args.listUid}".`);
          }

          const purchased = ctx.self.items.store.getPurchasedByList(args.listUid);
          if (purchased.length === 0) {
            return textResult(`No purchased items to clear in list "${list.name}".`);
          }

          const trashed = purchased.map((item) => ({ ...item, deleted: true }));
          try {
            const saved = await ctx.infra.client.saveGroceryItems(trashed);
            await ctx.self.commitGroceryItemsBatch(saved);
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

/**
 * Registers `clear_grocery_list`, kernel-shaped — batch soft-delete of ALL items in a
 * list, writing through `ctx.self.commitGroceryItemsBatch`. Body lifted verbatim from
 * `src/tools/grocery-clear.ts`.
 */
export function clearAllTool(ctx: DomainCtx<GrocerySelf, "aisle" | "pantry">): void {
  const log = ctx.infra.log.child({ component: "clear_grocery_list" });
  ctx.server.registerTool(
    "clear_grocery_list",
    {
      title: "Remove all items from a grocery list",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      description: "Clear all items from a grocery list.",
      inputSchema: {
        listUid: GroceryListUidSchema.describe("Grocery list UID to clear all items from"),
      },
    },
    async (args) => {
      log.info({ tool: "clear_grocery_list", listUid: args.listUid }, "tool invoked");
      return groceryStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const list = ctx.self.lists.store.get(args.listUid);
          if (!list) {
            return textResult(`No grocery list found with UID "${args.listUid}".`);
          }

          const items = ctx.self.items.store.getByListUid(args.listUid);
          if (items.length === 0) {
            return textResult(`No items to clear in list "${list.name}".`);
          }

          const trashed = items.map((item) => ({ ...item, deleted: true }));
          try {
            const saved = await ctx.infra.client.saveGroceryItems(trashed);
            await ctx.self.commitGroceryItemsBatch(saved);
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
