import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, errorResult, toolResult } from "../../../shared/tools.js";
import { groceryItemToMarkdown } from "../grocery-helpers.js";
import { GroceryItemUidSchema } from "../ids.js";
import { groceryStartGuard } from "./guards.js";

export const markGroceryItemPurchasedInputSchema = z
  .object({
    uid: GroceryItemUidSchema.describe("UID of the grocery item to mark purchased"),
  })
  .strict();

/**
 * `mark_grocery_item_purchased` — the purchased intent verb (marks a grocery item
 * bought), distinct from a free-form `update_grocery_item` edit.
 *
 * One-way: there is no "un-purchase" verb. A bought item's job on a shopping list is done;
 * to put it back, re-add it for the next trip via `add_grocery_items`.
 */
export const markGroceryItemPurchasedTool = defineTool(
  {
    name: "mark_grocery_item_purchased",
    title: "Mark a grocery item purchased",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Mark a grocery item as purchased (checked off) by UID.",
    inputSchema: markGroceryItemPurchasedInputSchema,
  },
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "mark_grocery_item_purchased" });
    return async (args) => {
      const existing = ctx.state.items.store.get(args.uid);
      if (existing === undefined) {
        return errorResult(
          `No grocery item found with UID "${args.uid}" (it may not exist or was already deleted). Use \`read_grocery_list\` to inspect its list.`,
        );
      }

      const updated: GroceryItem = { ...existing, purchased: true };
      const saved = (await ctx.infra.client.saveGroceryItems([updated])).match(
        (items) => items[0]!,
        (e) => {
          log.error({ err: e, uid: args.uid }, "saveGroceryItems failed");
          return errorResult(`Failed to mark grocery item purchased: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;
      const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryItem(saved));
      if (commitErr) return commitErr;

      return toolResult(groceryItemToMarkdown(saved, ctx.deps.aisle));
    };
  },
);
