import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { GroceryItem } from "../grocery-item/types.js";
import type { AisleUid } from "../ids.js";
import type { ServerContext } from "../types/server-context.js";

import { GroceryIngredientUidSchema, GroceryItemUidSchema, GroceryListUidSchema, NO_AISLE_UID } from "../ids.js";
import { toMessage } from "../utils/log.js";
import { ensureAisle } from "./aisle-helpers.js";
import {
  commitGroceryItem,
  commitGroceryItemsBatch,
  groceryItemToMarkdown,
  groceryStartGuard,
} from "./grocery-helpers.js";
import { textResult } from "./helpers.js";

const itemInputSchema = z.object({
  ingredient: z.string().min(1).describe("Ingredient name (required)"),
  quantity: z.string().optional().describe("Quantity, e.g. '2 lbs'"),
  aisle: z
    .string()
    .optional()
    .describe(
      "Aisle display name; omit to auto-resolve from the ingredient catalog. " +
        "When omitted and the ingredient has no catalog match, the item is placed in the Miscellaneous aisle.",
    ),
  instruction: z.string().optional().describe("Free-form notes for this item"),
});

export function registerAddGroceryItemsTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "add_grocery_items" });
  server.registerTool(
    "add_grocery_items",
    {
      description:
        "Add one or more items to a grocery list. Check read_grocery_list first to avoid duplicate ingredients — no server-side duplicate guard.",
      inputSchema: {
        listUid: GroceryListUidSchema.describe("UID of the grocery list to add items to"),
        items: z.array(itemInputSchema).min(1).describe("Array of items to add (1 or more)"),
      },
    },
    async (args) => {
      log.info({ tool: "add_grocery_items", listUid: args.listUid, count: args.items.length }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Validate listUid (already brand-typed by the input schema)
          const list = ctx.groceryListStore.get(args.listUid);
          if (list === undefined) {
            return textResult(`Grocery list with UID "${args.listUid}" not found.`);
          }

          // Validate all items (all-or-nothing before any API calls)
          for (const item of args.items) {
            if (item.ingredient.trim() === "") {
              return textResult(`Invalid item: ingredient must not be empty.`);
            }
          }

          // Build all GroceryItem objects, resolving aisles first
          const builtItems: Array<GroceryItem> = [];
          const batchAisleCache = new Map<string, { aisle: string; aisleUid: AisleUid }>();
          const catalogUpdated = new Set<string>();
          try {
            for (const item of args.items) {
              const ingredient = item.ingredient;
              const ingredientKey = ingredient.toLowerCase();
              const quantity = item.quantity ?? "";
              const instruction = item.instruction ?? "";
              const uid = GroceryItemUidSchema.parse(crypto.randomUUID().toUpperCase());
              const name = quantity !== "" ? `${quantity} ${ingredient}` : ingredient;

              let aisle: string;
              let aisleUid: AisleUid;

              if (item.aisle !== undefined) {
                const resolved = await ensureAisle(ctx, item.aisle);
                aisle = resolved.aisle;
                aisleUid = resolved.aisleUid;
                batchAisleCache.set(ingredientKey, { aisle, aisleUid });

                if (!catalogUpdated.has(ingredientKey)) {
                  catalogUpdated.add(ingredientKey);
                  const catalogEntry = ctx.groceryIngredientStore.lookupByName(ingredient);
                  if (catalogEntry !== undefined) {
                    const updated = { ...catalogEntry, aisleUid };
                    await ctx.client.saveGroceryIngredient(updated);
                    ctx.groceryIngredientStore.set(updated);
                    await ctx.cache.groceryIngredients.put(updated);
                  } else {
                    const created = {
                      uid: GroceryIngredientUidSchema.parse(crypto.randomUUID().toUpperCase()),
                      name: ingredient,
                      aisleUid,
                      deleted: false,
                    };
                    await ctx.client.saveGroceryIngredient(created);
                    ctx.groceryIngredientStore.set(created);
                    await ctx.cache.groceryIngredients.put(created);
                  }
                }
              } else {
                const batchHit = batchAisleCache.get(ingredientKey);
                if (batchHit !== undefined) {
                  aisle = batchHit.aisle;
                  aisleUid = batchHit.aisleUid;
                } else {
                  const catalogEntry = ctx.groceryIngredientStore.lookupByName(ingredient);
                  const resolvedAisle =
                    catalogEntry !== undefined ? ctx.aisleStore.get(catalogEntry.aisleUid) : undefined;
                  // No catalog memory (or it points at a now-missing aisle): place the
                  // item in the built-in "Miscellaneous" aisle, matching Paprika.app,
                  // which never leaves an item aisle-less. Fall back to "" only when the
                  // catalog has no Miscellaneous aisle (user-deleted, or a non-English
                  // catalog) — never auto-create it; it's a Paprika built-in.
                  const placement = resolvedAisle ?? ctx.aisleStore.resolveByName("Miscellaneous");
                  aisle = placement?.name ?? "";
                  aisleUid = placement?.uid ?? NO_AISLE_UID;
                }
              }

              const built: GroceryItem = {
                uid,
                name,
                ingredient,
                quantity,
                aisle,
                aisleUid,
                listUid: args.listUid,
                purchased: false,
                deleted: false,
                orderFlag: 0,
                instruction,
                recipe: null,
                separate: false,
              };
              builtItems.push(built);
            }
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, listUid: args.listUid }, "aisle resolution failed");
            return textResult(`Failed to add grocery items: ${message}`);
          }

          // Single batch POST for all items
          let savedItems: ReadonlyArray<GroceryItem>;
          try {
            savedItems = await ctx.client.saveGroceryItems(builtItems);
            await commitGroceryItemsBatch(ctx, savedItems);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, listUid: args.listUid }, "saveGroceryItems failed");
            return textResult(`Failed to add grocery items: ${message}`);
          }

          const count = savedItems.length;
          const rendered = savedItems.map((item) => groceryItemToMarkdown(item)).join("\n\n---\n\n");
          return textResult(`Added ${count.toString()} item(s) to the grocery list.\n\n${rendered}`);
        },
        (guard) => guard,
      );
    },
  );
}

export function registerUpdateGroceryItemTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "update_grocery_item" });
  server.registerTool(
    "update_grocery_item",
    {
      description:
        "Update an existing grocery item. Only provided fields are changed; omitted fields retain their current values.",
      inputSchema: {
        uid: GroceryItemUidSchema.describe("UID of the grocery item to update"),
        quantity: z.string().optional().describe("New quantity; set to empty string to clear"),
        aisle: z.string().optional().describe("New aisle display name"),
        instruction: z.string().optional().describe("New free-form notes"),
        purchased: z.boolean().optional().describe("Whether the item has been purchased"),
      },
    },
    async (args) => {
      log.info({ tool: "update_grocery_item", uid: args.uid }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.groceryItemStore.get(args.uid);
          if (existing === undefined) {
            return textResult(`No grocery item found with UID "${args.uid}".`);
          }

          let saved: GroceryItem;
          try {
            const aisleUpdate = args.aisle !== undefined ? await ensureAisle(ctx, args.aisle) : undefined;

            const newIngredient = existing.ingredient; // ingredient is not updatable
            const newQuantity = args.quantity !== undefined ? args.quantity : existing.quantity;
            const newName = newQuantity !== "" ? `${newQuantity} ${newIngredient}` : newIngredient;

            const updated: GroceryItem = {
              ...existing,
              ...(args.quantity !== undefined && { quantity: args.quantity }),
              ...(aisleUpdate !== undefined && { aisle: aisleUpdate.aisle, aisleUid: aisleUpdate.aisleUid }),
              ...(args.instruction !== undefined && { instruction: args.instruction }),
              ...(args.purchased !== undefined && { purchased: args.purchased }),
              name: newName,
            };

            saved = (await ctx.client.saveGroceryItems([updated]))[0]!;
            await commitGroceryItem(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveGroceryItems failed");
            return textResult(`Failed to update grocery item: ${message}`);
          }

          return textResult(groceryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    },
  );
}

export function registerDeleteGroceryItemTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "delete_grocery_item" });
  server.registerTool(
    "delete_grocery_item",
    {
      description: "Delete a grocery item by UID.",
      inputSchema: {
        uid: GroceryItemUidSchema.describe("Grocery item UID to delete"),
      },
    },
    async (args) => {
      log.info({ tool: "delete_grocery_item", uid: args.uid }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.groceryItemStore.get(args.uid);

          if (!existing) {
            // Distinguish "I deleted this in this session" (tombstone) from
            // "never existed". The store's tombstone set tracks UIDs deleted
            // via this client since the last sync; a retried delete on a
            // previously-deleted UID returns the idempotent "already deleted"
            // signal callers expect.
            if (ctx.groceryItemStore.isTombstone(args.uid)) {
              return textResult(`Grocery item with UID "${args.uid}" is already deleted.`);
            }
            return textResult(`No grocery item found with UID "${args.uid}".`);
          }

          if (existing.deleted) {
            // Defense-in-depth: if a tombstone ever lands in the items map
            // (e.g., from a future sync that returns deleted items), still
            // report it as already-deleted rather than re-saving.
            return textResult(`Grocery item "${existing.ingredient}" is already deleted.`);
          }

          const trashed = { ...existing, deleted: true };

          try {
            const saved = (await ctx.client.saveGroceryItems([trashed]))[0]!;
            await commitGroceryItem(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveGroceryItems failed");
            return textResult(`Failed to delete grocery item: ${message}`);
          }

          return textResult(`Grocery item "${existing.ingredient}" has been deleted.`);
        },
        (guard) => guard,
      );
    },
  );
}
