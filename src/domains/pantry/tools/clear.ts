import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryState, PantryWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, confirmOrCancel, errorResult, toolResult } from "../../../shared/tools.js";
import { pantryStartGuard } from "./guards.js";

/**
 * `clear_out_of_stock_pantry_items` — batch hard-delete all out-of-stock pantry items.
 */
export const clearOutOfStockPantryItemsTool = defineTool(
  {
    name: "clear_out_of_stock_pantry_items",
    title: "Remove all out-of-stock pantry items",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description: "Permanently delete all pantry items marked out of stock. Cannot be undone.",
    inputSchema: {},
  },
  [pantryStartGuard],
  (ctx: DomainCtx<PantryState, "aisle", PantryWrites>) => {
    const log = ctx.infra.log.child({ component: "clear_out_of_stock_pantry_items" });
    return async () => {
      const outOfStock = ctx.state.store.getAll().filter((i) => !i.inStock);
      if (outOfStock.length === 0) {
        return toolResult("No out-of-stock items to clear.");
      }

      const stop = await confirmOrCancel(ctx.server.server, {
        message: `Permanently remove the ${outOfStock.length.toString()} out-of-stock pantry item(s)? This cannot be undone (there is no restore).`,
        cancelled: "Cancelled — no pantry items were deleted.",
        log,
      });
      if (stop) return stop;

      const toDelete = outOfStock.map((i) => ({ ...i, deleted: true }));
      return (await ctx.infra.client.savePantryItems(toDelete)).match(
        async (saved) => {
          const commitErr = commitFailure("pantry", await ctx.writes.commitPantryItemsBatch(saved));
          if (commitErr) return commitErr;
          return toolResult(`Cleared ${toDelete.length.toString()} out-of-stock pantry item(s).`);
        },
        async (e) => {
          log.error({ err: e }, "savePantryItems (clear_out_of_stock_pantry_items) failed");
          return errorResult(`Failed to clear out-of-stock pantry items: ${e.message}`);
        },
      );
    };
  },
);
