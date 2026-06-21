import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryItem } from "../../pantry/types.js";
import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, confirmOrCancel, toolResult } from "../../../shared/tools.js";
import { todayWire } from "../../../utils/dates.js";
import { PantryItemUidSchema } from "../../pantry/ids.js";
import { GroceryItemUidSchema } from "../ids.js";
import { groceryStartGuard, pantrySyncedGuard } from "./guards.js";

/**
 * `move_grocery_items_to_pantry` — move grocery items into the pantry. This IS a
 * grocery tool despite the name: its input is grocery-item UIDs, its primary store is
 * grocery's own item store, and the pantry side goes THROUGH the declared `pantry`
 * dependency contract (`createItems`; `hasSynced` runs as `pantrySyncedGuard` precondition).
 *
 * Create-first/delete-second ordering matters: pantry items are created first (so a
 * pantry failure leaves the grocery items intact), then the grocery items are
 * soft-deleted. `ctx.deps.pantry.createItems` distinguishes the two failure phases
 * (`"save"` = nothing created server-side → safe to abort; `"commit"` = created
 * server-side but local commit failed → grocery items must NOT be deleted), so the
 * three partial-failure messages are exact.
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
  [groceryStartGuard, pantrySyncedGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "move_grocery_items_to_pantry" });
    return async (args) => {
      // Step 1: Validate all UIDs exist and deduplicate.
      // uids are already brand-typed by the input schema — no per-element parse.
      const seen = new Set<string>();
      const items: Array<GroceryItem> = [];
      for (const uid of args.uids) {
        if (seen.has(uid)) continue;
        seen.add(uid);
        const item = ctx.state.items.store.get(uid);
        if (!item) {
          return toolResult(
            `No grocery item found with UID "${uid}" (it may not exist or was already deleted). Use \`read_grocery_list\` to inspect its list.`,
          );
        }
        items.push(item);
      }

      const stop = await confirmOrCancel(ctx.server.server, {
        message: `Move ${items.length.toString()} item(s) to the pantry? They'll leave the grocery list.`,
        cancelled: `Cancelled — nothing was moved to the pantry.`,
      });
      if (stop) return stop;

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
      return createResult.match(
        async (savedPantry) => {
          // Step 4: THEN DELETE — soft-delete grocery items
          const trashedGrocery = items.map((gi) => ({ ...gi, deleted: true }));
          const savedGrocery = (await ctx.infra.client.saveGroceryItems(trashedGrocery)).match(
            (v) => v,
            (e) => {
              // Partial failure: pantry items created but grocery delete failed.
              // Return structured message so user knows the state.
              log.error({ err: e, uids: args.uids }, "saveGroceryItems (delete) failed after pantry create");
              const pantryUids = savedPantry.map((p) => p.uid).join(", ");
              return toolResult(
                `Partial failure: ${savedPantry.length.toString()} pantry item(s) were created (UIDs: ${pantryUids}), ` +
                  `but the grocery item delete failed: ${e.message}. ` +
                  `The items may exist in both grocery and pantry. You can manually delete the grocery items.`,
              );
            },
          );
          if ("content" in savedGrocery) return savedGrocery;
          const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryItemsBatch(savedGrocery));
          if (commitErr) return commitErr;

          // Step 5: Success response
          const movedNames = items.map((gi) => gi.ingredient).join(", ");
          const pantryUids = savedPantry.map((p) => p.uid).join(", ");
          return toolResult(
            `Moved ${items.length.toString()} item(s) to pantry: ${movedNames}.\nNew pantry UIDs: ${pantryUids}`,
          );
        },
        async (error) => {
          log.error({ uids: args.uids, phase: error.phase }, `createItems failed (${error.phase})`);
          if (error.phase === "save") {
            return toolResult(`Failed to create pantry items: ${error.message}. No grocery items were deleted.`);
          }
          const pantryUids = error.saved.map((p) => p.uid).join(", ");
          return toolResult(
            `Pantry items were created on the server (UIDs: ${pantryUids}) but the local cache commit failed: ${error.message}. ` +
              `Grocery items were NOT deleted. The pantry items will appear after the next sync cycle.`,
          );
        },
      );
    };
  },
);
