import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantrySelf } from "../module.js";
import type { PantryItem } from "../types.js";

import { PantryItemUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
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
 * Registers `mark_pantry_item_out_of_stock`, kernel-shaped — `inStock` is an intent
 * verb (ADR-0008), so it lives here, not on `update_pantry_item`. Writes through
 * `ctx.self.commitPantryItem`. Body lifted verbatim from `src/tools/pantry-stock.ts`.
 */
export function markPantryItemOutOfStockTool(ctx: DomainCtx<PantrySelf, "aisle">): void {
  const log = ctx.infra.log.child({ component: "mark_pantry_item_out_of_stock" });
  ctx.server.registerTool(
    "mark_pantry_item_out_of_stock",
    {
      title: "Mark a pantry item out of stock",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Mark a pantry item as out of stock by UID (e.g. you've run out of it).",
      inputSchema: markPantryItemOutOfStockInputSchema,
    },
    async (args) => {
      log.info({ tool: "mark_pantry_item_out_of_stock", uid: args.uid }, "tool invoked");
      return pantryStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.self.store.get(args.uid);

          if (!existing) {
            return textResult(`No pantry item found with UID "${args.uid}".`);
          }

          let saved: PantryItem;
          try {
            const updated: PantryItem = { ...existing, inStock: false };
            saved = (await ctx.infra.client.savePantryItems([updated]))[0]!;
            await ctx.self.commitPantryItem(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "savePantryItems failed");
            return textResult(`Failed to update pantry item: ${message}`);
          }

          return textResult(pantryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    },
  );
}

/**
 * Registers `restock_pantry_item`, kernel-shaped — the in-stock intent verb's
 * mirror. Writes through `ctx.self.commitPantryItem`. Body lifted verbatim from
 * `src/tools/pantry-stock.ts`.
 */
export function restockPantryItemTool(ctx: DomainCtx<PantrySelf, "aisle">): void {
  const log = ctx.infra.log.child({ component: "restock_pantry_item" });
  ctx.server.registerTool(
    "restock_pantry_item",
    {
      title: "Mark a pantry item back in stock",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Mark a pantry item as back in stock by UID (e.g. you've restocked it).",
      inputSchema: restockPantryItemInputSchema,
    },
    async (args) => {
      log.info({ tool: "restock_pantry_item", uid: args.uid }, "tool invoked");
      return pantryStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.self.store.get(args.uid);

          if (!existing) {
            return textResult(`No pantry item found with UID "${args.uid}".`);
          }

          let saved: PantryItem;
          try {
            const updated: PantryItem = { ...existing, inStock: true };
            saved = (await ctx.infra.client.savePantryItems([updated]))[0]!;
            await ctx.self.commitPantryItem(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "savePantryItems failed");
            return textResult(`Failed to update pantry item: ${message}`);
          }

          return textResult(pantryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    },
  );
}

/** Both in/out-of-stock intent verbs, spread into the module's `tools` array. */
export const pantryStockTools = [markPantryItemOutOfStockTool, restockPantryItemTool];
