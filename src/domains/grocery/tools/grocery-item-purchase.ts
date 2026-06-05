import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { GroceryItemUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { groceryItemToMarkdown } from "../grocery-helpers.js";
import { groceryStartGuard } from "./guards.js";

export const markGroceryItemPurchasedInputSchema = z
  .object({
    uid: GroceryItemUidSchema.describe("UID of the grocery item to mark purchased"),
  })
  .strict();

/**
 * `mark_grocery_item_purchased` — the purchased intent verb (marks a grocery item
 * bought), distinct from a free-form `update_grocery_item` edit.
 */
export const markGroceryItemPurchasedTool = defineTool(
  {
    name: "mark_grocery_item_purchased",
    title: "Mark a grocery item purchased",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Mark a grocery item as purchased (checked off) by UID.",
    inputSchema: markGroceryItemPurchasedInputSchema,
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "mark_grocery_item_purchased" });
    return async (args) => {
      log.info({ tool: "mark_grocery_item_purchased", uid: args.uid }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.items.store.get(args.uid);
          if (existing === undefined) {
            return textResult(
              `No grocery item found with UID "${args.uid}" (it may not exist or was already deleted).`,
            );
          }

          let saved: GroceryItem;
          try {
            const updated: GroceryItem = { ...existing, purchased: true };
            saved = (await ctx.infra.client.saveGroceryItems([updated]))[0]!;
            await ctx.writes.commitGroceryItem(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveGroceryItems failed");
            return textResult(`Failed to mark grocery item purchased: ${message}`);
          }

          return textResult(groceryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    };
  },
);
