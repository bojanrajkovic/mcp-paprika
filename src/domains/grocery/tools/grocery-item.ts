import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { AisleUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryState } from "../module.js";

import { GroceryIngredientUidSchema, GroceryItemUidSchema, GroceryListUidSchema, NO_AISLE_UID } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { groceryItemToMarkdown } from "../grocery-helpers.js";
import { groceryStartGuard } from "./guards.js";

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

/**
 * Registers `add_grocery_items`, kernel-shaped — resolves aisles via the declared
 * `aisle` dependency contract (`ctx.deps.aisle.ensureAisle` / `.get` / `.resolveByName`,
 * never reaching aisle's store) and writes the grocery-ingredient catalog through
 * this module's OWN ingredient store + cache (`ctx.state.ingredients.*` — ingredient
 * is a co-owned grocery entity, so the catalog write stays in `self`). Items commit
 * through this module's bound `ctx.state.commitGroceryItemsBatch`.
 */
export const addGroceryItemsTool = defineTool(
  {
    name: "add_grocery_items",
    title: "Add items to a grocery list",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    description:
      "Add one or more items to a grocery list. Check read_grocery_list first to avoid duplicate ingredients — no server-side duplicate guard.",
    inputSchema: {
      listUid: GroceryListUidSchema.describe("UID of the grocery list to add items to"),
      items: z.array(itemInputSchema).min(1).describe("Array of items to add (1 or more)"),
    },
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry">) => {
    const log = ctx.infra.log.child({ component: "add_grocery_items" });
    return async (args) => {
      log.info({ tool: "add_grocery_items", listUid: args.listUid, count: args.items.length }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          // Validate listUid (already brand-typed by the input schema)
          const list = ctx.state.lists.store.get(args.listUid);
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
                const resolved = await ctx.deps.aisle.ensureAisle(item.aisle);
                aisle = resolved.aisle;
                aisleUid = resolved.aisleUid;
                batchAisleCache.set(ingredientKey, { aisle, aisleUid });

                if (!catalogUpdated.has(ingredientKey)) {
                  catalogUpdated.add(ingredientKey);
                  const catalogEntry = ctx.state.ingredients.store.lookupByName(ingredient);
                  if (catalogEntry !== undefined) {
                    const updated = { ...catalogEntry, aisleUid };
                    await ctx.infra.client.saveGroceryIngredient(updated);
                    ctx.state.ingredients.store.set(updated);
                    await ctx.state.ingredients.cache.put(updated);
                  } else {
                    const created = {
                      uid: GroceryIngredientUidSchema.parse(crypto.randomUUID().toUpperCase()),
                      name: ingredient,
                      aisleUid,
                      deleted: false,
                    };
                    await ctx.infra.client.saveGroceryIngredient(created);
                    ctx.state.ingredients.store.set(created);
                    await ctx.state.ingredients.cache.put(created);
                  }
                }
              } else {
                const batchHit = batchAisleCache.get(ingredientKey);
                if (batchHit !== undefined) {
                  aisle = batchHit.aisle;
                  aisleUid = batchHit.aisleUid;
                } else {
                  const catalogEntry = ctx.state.ingredients.store.lookupByName(ingredient);
                  const resolvedAisle =
                    catalogEntry !== undefined ? ctx.deps.aisle.get(catalogEntry.aisleUid) : undefined;
                  // No catalog memory (or it points at a now-missing aisle): place the
                  // item in the built-in "Miscellaneous" aisle, matching Paprika.app,
                  // which never leaves an item aisle-less. Fall back to "" only when the
                  // catalog has no Miscellaneous aisle (user-deleted, or a non-English
                  // catalog) — never auto-create it; it's a Paprika built-in.
                  const placement = resolvedAisle ?? ctx.deps.aisle.resolveByName("Miscellaneous");
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
            savedItems = await ctx.infra.client.saveGroceryItems(builtItems);
            await ctx.state.commitGroceryItemsBatch(savedItems);
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
    };
  },
);

// Strict (exported for direct Zod-validation tests). `purchased` was promoted to
// its own intent verb (mark_grocery_item_purchased), so a stray `purchased` key
// here is a loud rejection rather than a silently dropped field.
export const updateGroceryItemInputSchema = z
  .object({
    uid: GroceryItemUidSchema.describe("UID of the grocery item to update"),
    quantity: z.string().optional().describe("New quantity; set to empty string to clear"),
    aisle: z.string().optional().describe("New aisle display name"),
    instruction: z.string().optional().describe("New free-form notes"),
  })
  .strict();

/**
 * Registers `update_grocery_item`, kernel-shaped — resolves the aisle via
 * `ctx.deps.aisle.ensureAisle` and writes through `ctx.state.commitGroceryItem`.
 */
export const updateGroceryItemTool = defineTool(
  {
    name: "update_grocery_item",
    title: "Edit a grocery item",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Update a grocery item's quantity, aisle, or notes by UID. Only provided fields are changed; " +
      "omitted fields retain their current values. To check an item off, use mark_grocery_item_purchased.",
    inputSchema: updateGroceryItemInputSchema,
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry">) => {
    const log = ctx.infra.log.child({ component: "update_grocery_item" });
    return async (args) => {
      log.info({ tool: "update_grocery_item", uid: args.uid }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.items.store.get(args.uid);
          if (existing === undefined) {
            return textResult(
              `No grocery item found with UID "${args.uid}" (it may not exist or was already deleted).`,
            );
          }

          let saved: GroceryItem;
          try {
            const aisleUpdate = args.aisle !== undefined ? await ctx.deps.aisle.ensureAisle(args.aisle) : undefined;

            const newIngredient = existing.ingredient; // ingredient is not updatable
            const newQuantity = args.quantity !== undefined ? args.quantity : existing.quantity;
            const newName = newQuantity !== "" ? `${newQuantity} ${newIngredient}` : newIngredient;

            const updated: GroceryItem = {
              ...existing,
              ...(args.quantity !== undefined && { quantity: args.quantity }),
              ...(aisleUpdate !== undefined && { aisle: aisleUpdate.aisle, aisleUid: aisleUpdate.aisleUid }),
              ...(args.instruction !== undefined && { instruction: args.instruction }),
              name: newName,
            };

            saved = (await ctx.infra.client.saveGroceryItems([updated]))[0]!;
            await ctx.state.commitGroceryItem(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveGroceryItems failed");
            return textResult(`Failed to update grocery item: ${message}`);
          }

          return textResult(groceryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    };
  },
);

/**
 * Registers `delete_grocery_item`, kernel-shaped — soft-delete tombstone, writing
 * through `ctx.state.commitGroceryItem`.
 */
export const deleteGroceryItemTool = defineTool(
  {
    name: "delete_grocery_item",
    title: "Delete a grocery item",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description: "Delete a grocery item by UID.",
    inputSchema: {
      uid: GroceryItemUidSchema.describe("Grocery item UID to delete"),
    },
  },
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry">) => {
    const log = ctx.infra.log.child({ component: "delete_grocery_item" });
    return async (args) => {
      log.info({ tool: "delete_grocery_item", uid: args.uid }, "tool invoked");
      return groceryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.items.store.get(args.uid);

          if (!existing) {
            return textResult(
              `No grocery item found with UID "${args.uid}" (it may not exist or was already deleted).`,
            );
          }

          const trashed = { ...existing, deleted: true };

          try {
            const saved = (await ctx.infra.client.saveGroceryItems([trashed]))[0]!;
            await ctx.state.commitGroceryItem(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveGroceryItems failed");
            return textResult(`Failed to delete grocery item: ${message}`);
          }

          return textResult(`Grocery item "${existing.ingredient}" has been deleted.`);
        },
        (guard) => guard,
      );
    };
  },
);
