import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryState, PantryWrites } from "../module.js";
import type { PantryItem } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { PantryItemUidSchema } from "../ids.js";
import { pantryItemToMarkdown } from "../pantry-helpers.js";
import { pantryStartGuard } from "./guards.js";

export const markPantryItemOutOfStockInputSchema = z
  .object({
    uid: PantryItemUidSchema.describe("UID of the pantry item to mark out of stock"),
  })
  .strict();

export const restockPantryItemInputSchema = z
  .object({
    uid: PantryItemUidSchema.describe("UID of the pantry item to restock"),
  })
  .strict();

/**
 * `mark_pantry_item_out_of_stock` — flip a pantry item to out-of-stock. `inStock` is
 * an intent verb (ADR-0008), so it lives here, not on `update_pantry_item`.
 */
export const markPantryItemOutOfStockTool = defineTool(
  {
    name: "mark_pantry_item_out_of_stock",
    title: "Mark a pantry item out of stock",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Mark a pantry item as out of stock by UID (e.g. you've run out of it).",
    inputSchema: markPantryItemOutOfStockInputSchema,
  },
  [pantryStartGuard],
  (ctx: DomainCtx<PantryState, "aisle", PantryWrites>) => {
    const log = ctx.infra.log.child({ component: "mark_pantry_item_out_of_stock" });
    return async (args) => {
      const existing = ctx.state.store.get(args.uid);

      if (!existing) {
        return textResult(`No pantry item found with UID "${args.uid}" (it may not exist or was already deleted).`);
      }

      const updated: PantryItem = { ...existing, inStock: false };
      const saved = (await ctx.infra.client.savePantryItems([updated])).match(
        (items) => items[0]!,
        (e) => {
          log.error({ err: e, uid: args.uid }, "savePantryItems failed");
          return textResult(`Failed to update pantry item: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;
      const commitErr = commitFailure("pantry", await ctx.writes.commitPantryItem(saved));
      if (commitErr) return commitErr;

      return textResult(pantryItemToMarkdown(saved, ctx.deps.aisle));
    };
  },
);

/**
 * `restock_pantry_item` — the in-stock intent verb, mirror of
 * `mark_pantry_item_out_of_stock` (ADR-0008).
 */
export const restockPantryItemTool = defineTool(
  {
    name: "restock_pantry_item",
    title: "Mark a pantry item back in stock",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Mark a pantry item as back in stock by UID (e.g. you've restocked it).",
    inputSchema: restockPantryItemInputSchema,
  },
  [pantryStartGuard],
  (ctx: DomainCtx<PantryState, "aisle", PantryWrites>) => {
    const log = ctx.infra.log.child({ component: "restock_pantry_item" });
    return async (args) => {
      const existing = ctx.state.store.get(args.uid);

      if (!existing) {
        return textResult(`No pantry item found with UID "${args.uid}" (it may not exist or was already deleted).`);
      }

      const updated: PantryItem = { ...existing, inStock: true };
      const saved = (await ctx.infra.client.savePantryItems([updated])).match(
        (items) => items[0]!,
        (e) => {
          log.error({ err: e, uid: args.uid }, "savePantryItems failed");
          return textResult(`Failed to update pantry item: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;
      const commitErr = commitFailure("pantry", await ctx.writes.commitPantryItem(saved));
      if (commitErr) return commitErr;

      return textResult(pantryItemToMarkdown(saved, ctx.deps.aisle));
    };
  },
);

/** Both in/out-of-stock intent verbs, spread into the module's `tools` array. */
export const pantryStockTools = [markPantryItemOutOfStockTool, restockPantryItemTool];
