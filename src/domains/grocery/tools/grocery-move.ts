import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryItem } from "../../pantry/types.js";
import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryState } from "../module.js";

import { GroceryItemUidSchema, PantryItemUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { todayWire } from "../../../utils/dates.js";
import { toMessage } from "../../../utils/log.js";
import { groceryStartGuard } from "./guards.js";

/**
 * Registers `move_grocery_items_to_pantry`, kernel-shaped — this IS a grocery tool
 * despite the name: its input is grocery-item UIDs, its primary store is grocery's
 * own item store, and the pantry side goes THROUGH the declared `pantry` dependency
 * contract (`ctx.deps.pantry.hasSynced` / `createItems`), never reaching pantry's
 * store.
 *
 * The live create-first/delete-second ordering is preserved: pantry items are created
 * first (so a pantry failure leaves the grocery items intact), then the grocery items
 * are soft-deleted. `ctx.deps.pantry.createItems` internalizes the live
 * `savePantryItems` + `commitPantryItemsBatch` sequence and distinguishes the two
 * failure phases (`"save"` = nothing created server-side → safe to abort;
 * `"commit"` = created server-side but local commit failed → grocery items must NOT
 * be deleted) so the three partial-failure messages survive the migration unchanged.
 */
export const moveToPantryTool = defineTool(
  {
    name: "move_grocery_items_to_pantry",
    title: "Move grocery items to the pantry",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    description:
      "Move one or more grocery items to the pantry. Creates pantry items (with today's purchase date), then deletes the grocery items.",
    inputSchema: {
      uids: z.array(GroceryItemUidSchema).min(1).describe("Grocery item UIDs to move to pantry"),
    },
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry">) => {
    const log = ctx.infra.log.child({ component: "move_grocery_items_to_pantry" });
    return async (args) => {
      log.info({ tool: "move_grocery_items_to_pantry", count: args.uids.length }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          if (!ctx.deps.pantry.hasSynced()) {
            return textResult("Pantry is not yet synced. Try again in a few seconds.");
          }

          // Step 1: Validate all UIDs exist and deduplicate.
          // uids are already brand-typed by the input schema — no per-element parse.
          const seen = new Set<string>();
          const items: Array<GroceryItem> = [];
          for (const uid of args.uids) {
            if (seen.has(uid)) continue;
            seen.add(uid);
            const item = ctx.state.items.store.get(uid);
            if (!item) {
              return textResult(`No grocery item found with UID "${uid}" (it may not exist or was already deleted).`);
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

          // Step 3: CREATE FIRST — persist pantry items through the pantry contract.
          // `createItems` POSTs then commits, returning the failure phase so the two
          // modes stay distinguishable (matching the live tool's separate messages):
          // a `save` failure means nothing was created server-side; a `commit` failure
          // means the items exist server-side and surface after the next sync.
          const createResult = await ctx.deps.pantry.createItems(pantryItems);
          const moveResult = await createResult.match(
            async (savedPantry): Promise<CallToolResult> => {
              // Step 4: THEN DELETE — soft-delete grocery items
              const trashedGrocery = items.map((gi) => ({ ...gi, deleted: true }));
              try {
                const savedGrocery = await ctx.infra.client.saveGroceryItems(trashedGrocery);
                await ctx.state.commitGroceryItemsBatch(savedGrocery);
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
            async (error): Promise<CallToolResult> => {
              log.error({ uids: args.uids, phase: error.phase }, `createItems failed (${error.phase})`);
              if (error.phase === "save") {
                return textResult(`Failed to create pantry items: ${error.message}. No grocery items were deleted.`);
              }
              const pantryUids = error.saved.map((p) => p.uid).join(", ");
              return textResult(
                `Pantry items were created on the server (UIDs: ${pantryUids}) but the local cache commit failed: ${error.message}. ` +
                  `Grocery items were NOT deleted. The pantry items will appear after the next sync cycle.`,
              );
            },
          );
          return moveResult;
        },
        (guard) => guard,
      );
    };
  },
);
