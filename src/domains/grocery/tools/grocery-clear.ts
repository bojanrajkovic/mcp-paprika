import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, confirmOrCancel, errorResult, toolResult } from "../../../shared/tools.js";
import { GroceryListUidSchema } from "../ids.js";
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
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "clear_purchased_grocery_items" });
    return async (args) => {
      const list = ctx.state.lists.store.get(args.listUid);
      if (!list) {
        return errorResult(
          `No grocery list found with UID "${args.listUid}" (it may not exist or was already deleted).`,
        );
      }

      const purchased = ctx.state.items.store.getPurchasedByList(args.listUid);
      if (purchased.length === 0) {
        return toolResult(`No purchased items to clear in list "${list.name}".`);
      }

      const stop = await confirmOrCancel(ctx.server.server, {
        message: `Remove the ${purchased.length.toString()} purchased item(s) from "${list.name}"? This is permanent.`,
        cancelled: `Cancelled — "${list.name}" was not cleared.`,
      });
      if (stop) return stop;

      const trashed = purchased.map((item) => ({ ...item, deleted: true }));
      return (await ctx.infra.client.saveGroceryItems(trashed)).match(
        async (saved) => {
          const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryItemsBatch(saved));
          if (commitErr) return commitErr;
          return toolResult(`Cleared ${trashed.length.toString()} purchased item(s) from "${list.name}".`);
        },
        async (e) => {
          log.error({ err: e, listUid: args.listUid }, "saveGroceryItems (clear_purchased_grocery_items) failed");
          return errorResult(`Failed to clear purchased items from "${list.name}": ${e.message}`);
        },
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
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "clear_grocery_list" });
    return async (args) => {
      const list = ctx.state.lists.store.get(args.listUid);
      if (!list) {
        return errorResult(
          `No grocery list found with UID "${args.listUid}" (it may not exist or was already deleted).`,
        );
      }

      const items = ctx.state.items.store.getByListUid(args.listUid);
      if (items.length === 0) {
        return toolResult(`No items to clear in list "${list.name}".`);
      }

      const stop = await confirmOrCancel(ctx.server.server, {
        message: `Remove all ${items.length.toString()} item(s) from "${list.name}"? This is permanent.`,
        cancelled: `Cancelled — "${list.name}" was not cleared.`,
      });
      if (stop) return stop;

      const trashed = items.map((item) => ({ ...item, deleted: true }));
      return (await ctx.infra.client.saveGroceryItems(trashed)).match(
        async (saved) => {
          const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryItemsBatch(saved));
          if (commitErr) return commitErr;
          return toolResult(`Cleared ${trashed.length.toString()} item(s) from "${list.name}".`);
        },
        async (e) => {
          log.error({ err: e, listUid: args.listUid }, "saveGroceryItems (clear_grocery_list) failed");
          return errorResult(`Failed to clear items from "${list.name}": ${e.message}`);
        },
      );
    };
  },
);
