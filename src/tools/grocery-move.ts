import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { GroceryItem } from "../grocery-item/types.js";
import type { PantryItem } from "../pantry/types.js";
import type { ServerContext } from "../types/server-context.js";

import { GroceryItemUidSchema, PantryItemUidSchema } from "../ids.js";
import { todayWire } from "../utils/dates.js";
import { toMessage } from "../utils/log.js";
import { commitGroceryItemsBatch, groceryStartGuard } from "./grocery-helpers.js";
import { textResult } from "./helpers.js";
import { commitPantryItemsBatch } from "./pantry-helpers.js";

export function registerMoveToPantryTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "move_grocery_items_to_pantry" });
  server.registerTool(
    "move_grocery_items_to_pantry",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      description:
        "Move one or more grocery items to the pantry. Creates pantry items (with today's purchase date), then deletes the grocery items.",
      inputSchema: {
        uids: z.array(GroceryItemUidSchema).min(1).describe("Grocery item UIDs to move to pantry"),
      },
    },
    async (args) => {
      log.info({ tool: "move_grocery_items_to_pantry", count: args.uids.length }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (!ctx.pantryStore.hasSynced) {
            return textResult("Pantry is not yet synced. Try again in a few seconds.");
          }

          // Step 1: Validate all UIDs exist, are not tombstoned, and deduplicate.
          // uids are already brand-typed by the input schema — no per-element parse.
          const seen = new Set<string>();
          const items: Array<GroceryItem> = [];
          for (const uid of args.uids) {
            if (seen.has(uid)) continue;
            seen.add(uid);
            const item = ctx.groceryItemStore.get(uid);
            if (!item) {
              if (ctx.groceryItemStore.isTombstone(uid)) {
                return textResult(`Grocery item with UID "${uid}" is already deleted.`);
              }
              return textResult(`No grocery item found with UID "${uid}".`);
            }
            items.push(item);
          }

          // Step 2: Build PantryItem objects from GroceryItem fields
          const pantryItems: Array<PantryItem> = items.map((gi) => ({
            uid: PantryItemUidSchema.parse(crypto.randomUUID().toUpperCase()),
            ingredient: gi.ingredient,
            quantity: "", // Intentionally empty — grocery quantity is purchase amount, not stock
            aisle: gi.aisle,
            aisleUid: gi.aisleUid,
            expirationDate: null,
            hasExpiration: false,
            inStock: true,
            purchaseDate: todayWire(),
            notes: null,
            deleted: false,
          }));

          // Step 3: CREATE FIRST — save pantry items (API call separated from
          // local commit so the error message distinguishes the two failure modes)
          let savedPantry: ReadonlyArray<PantryItem>;
          try {
            savedPantry = await ctx.client.savePantryItems(pantryItems);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uids: args.uids }, "savePantryItems failed");
            return textResult(`Failed to create pantry items: ${message}. No grocery items were deleted.`);
          }

          try {
            await commitPantryItemsBatch(ctx, savedPantry);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uids: args.uids }, "commitPantryItemsBatch failed after API success");
            const pantryUids = savedPantry.map((p) => p.uid).join(", ");
            return textResult(
              `Pantry items were created on the server (UIDs: ${pantryUids}) but the local cache commit failed: ${message}. ` +
                `Grocery items were NOT deleted. The pantry items will appear after the next sync cycle.`,
            );
          }

          // Step 4: THEN DELETE — soft-delete grocery items
          const trashedGrocery = items.map((gi) => ({ ...gi, deleted: true }));
          try {
            const savedGrocery = await ctx.client.saveGroceryItems(trashedGrocery);
            await commitGroceryItemsBatch(ctx, savedGrocery);
          } catch (error) {
            // Partial failure: pantry items created but grocery delete failed.
            // Return structured message so user knows the state.
            const message = toMessage(error);
            log.error({ err: error, uids: args.uids }, "saveGroceryItems (delete) failed after pantry create");
            const pantryUids = savedPantry.map((p) => p.uid).join(", ");
            return textResult(
              `Partial failure: ${savedPantry.length.toString()} pantry item(s) were created (UIDs: ${pantryUids}), ` +
                `but the grocery item delete failed: ${message}. ` +
                `The items may exist in both grocery and pantry. You can manually delete the grocery items.`,
            );
          }

          // Step 5: Success response
          const movedNames = items.map((gi) => gi.ingredient).join(", ");
          const pantryUids = savedPantry.map((p) => p.uid).join(", ");
          return textResult(
            `Moved ${items.length.toString()} item(s) to pantry: ${movedNames}.\nNew pantry UIDs: ${pantryUids}`,
          );
        },
        (guard) => guard,
      );
    },
  );
}
