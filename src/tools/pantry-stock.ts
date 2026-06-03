import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { PantryItem } from "../pantry/types.js";
import type { ServerContext } from "../types/server-context.js";

import { PantryItemUidSchema } from "../ids.js";
import { toMessage } from "../utils/log.js";
import { textResult } from "./helpers.js";
import { commitPantryItem, pantryItemToMarkdown, pantryStartGuard } from "./pantry-helpers.js";

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

export function registerMarkPantryItemOutOfStockTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "mark_pantry_item_out_of_stock" });
  server.registerTool(
    "mark_pantry_item_out_of_stock",
    {
      title: "Mark a pantry item out of stock",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Mark a pantry item as out of stock by UID (e.g. you've run out of it).",
      inputSchema: markPantryItemOutOfStockInputSchema,
    },
    async (args) => {
      log.info({ tool: "mark_pantry_item_out_of_stock", uid: args.uid }, "tool invoked");
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.pantryStore.get(args.uid);

          if (!existing) {
            return textResult(`No pantry item found with UID "${args.uid}".`);
          }

          let saved: PantryItem;
          try {
            const updated: PantryItem = { ...existing, inStock: false };
            saved = (await ctx.client.savePantryItems([updated]))[0]!;
            await commitPantryItem(ctx, saved);
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

export function registerRestockPantryItemTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "restock_pantry_item" });
  server.registerTool(
    "restock_pantry_item",
    {
      title: "Mark a pantry item back in stock",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Mark a pantry item as back in stock by UID (e.g. you've restocked it).",
      inputSchema: restockPantryItemInputSchema,
    },
    async (args) => {
      log.info({ tool: "restock_pantry_item", uid: args.uid }, "tool invoked");
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.pantryStore.get(args.uid);

          if (!existing) {
            return textResult(`No pantry item found with UID "${args.uid}".`);
          }

          let saved: PantryItem;
          try {
            const updated: PantryItem = { ...existing, inStock: true };
            saved = (await ctx.client.savePantryItems([updated]))[0]!;
            await commitPantryItem(ctx, saved);
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
