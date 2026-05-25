// pattern: Imperative Shell
import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  GroceryItemUidSchema,
  GroceryListUidSchema,
  GroceryIngredientUidSchema,
  AisleUidSchema,
} from "../paprika/types.js";
import type { GroceryItem } from "../paprika/types.js";
import { textResult } from "./helpers.js";
import { ensureAisle } from "./aisle-helpers.js";
import { commitGroceryItem, groceryItemToMarkdown, groceryStartGuard } from "./grocery-helpers.js";
import type { ServerContext } from "../types/server-context.js";

const itemInputSchema = z.object({
  ingredient: z.string().min(1).describe("Ingredient name (required)"),
  quantity: z.string().optional().describe("Quantity, e.g. '2 lbs'"),
  aisle: z.string().optional().describe("Aisle display name; omit to auto-resolve from ingredient catalog."),
  instruction: z.string().optional().describe("Free-form notes for this item"),
});

export function registerAddGroceryItemsTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "add_grocery_items" });
  server.registerTool(
    "add_grocery_items",
    {
      description:
        "Add one or more items to a grocery list. Before adding, call read_grocery_list to check for " +
        "existing items with the same ingredient — consolidate quantities rather than creating duplicates.",
      inputSchema: {
        listUid: z.string().min(1).describe("UID of the grocery list to add items to"),
        items: z.array(itemInputSchema).min(1).describe("Array of items to add (1 or more)"),
      },
    },
    async (args) => {
      log.info({ tool: "add_grocery_items", listUid: args.listUid, count: args.items.length }, "tool invoked");
      return groceryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Validate listUid
          const listUid = GroceryListUidSchema.parse(args.listUid);
          const list = ctx.groceryListStore.get(listUid);
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
          let builtItems: Array<GroceryItem>;
          try {
            builtItems = await Promise.all(
              args.items.map(async (item) => {
                const ingredient = item.ingredient;
                const quantity = item.quantity ?? "";
                const instruction = item.instruction ?? "";
                const uid = GroceryItemUidSchema.parse(crypto.randomUUID().toUpperCase());
                const name = quantity !== "" ? `${quantity} ${ingredient}` : ingredient;

                let aisle: string;
                let aisleUid: string;

                if (item.aisle !== undefined) {
                  // Explicit aisle: resolve via ensureAisle, then update ingredient catalog
                  const resolved = await ensureAisle(ctx, item.aisle);
                  aisle = resolved.aisle;
                  aisleUid = resolved.aisleUid;

                  // Update ingredient catalog (create or update)
                  const catalogEntry = ctx.groceryIngredientStore.lookupByName(ingredient);
                  if (catalogEntry !== undefined) {
                    await ctx.client.saveGroceryIngredient({ ...catalogEntry, aisleUid });
                  } else {
                    await ctx.client.saveGroceryIngredient({
                      uid: GroceryIngredientUidSchema.parse(crypto.randomUUID().toUpperCase()),
                      name: ingredient,
                      aisleUid,
                      deleted: false,
                    });
                  }
                } else {
                  // Auto-resolve aisle from ingredient catalog
                  const catalogEntry = ctx.groceryIngredientStore.lookupByName(ingredient);
                  if (catalogEntry !== undefined) {
                    const resolvedAisle = ctx.aisleStore.get(AisleUidSchema.parse(catalogEntry.aisleUid));
                    aisle = resolvedAisle !== undefined ? resolvedAisle.name : "";
                    aisleUid = resolvedAisle !== undefined ? resolvedAisle.uid : "";
                  } else {
                    aisle = "";
                    aisleUid = "";
                  }
                }

                return {
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
                } satisfies GroceryItem;
              }),
            );
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, listUid: args.listUid }, "aisle resolution failed");
            return textResult(`Failed to add grocery items: ${message}`);
          }

          // Single batch POST for all items
          let savedItems: ReadonlyArray<GroceryItem>;
          try {
            savedItems = await ctx.client.saveGroceryItems(builtItems);
            for (const saved of savedItems) {
              await commitGroceryItem(ctx, saved);
            }
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
        uid: z.string().min(1).describe("UID of the grocery item to update"),
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
          const uid = GroceryItemUidSchema.parse(args.uid);
          const existing = ctx.groceryItemStore.get(uid);
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
