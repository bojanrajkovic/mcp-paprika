import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "pino";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { AisleUid } from "../../aisle/ids.js";
import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, toolResult } from "../../../shared/tools.js";
import { NO_AISLE_UID } from "../../aisle/ids.js";
import { groceryItemToMarkdown } from "../grocery-helpers.js";
import { GroceryIngredientUidSchema, GroceryItemUidSchema, GroceryListUidSchema } from "../ids.js";
import { groceryStartGuard } from "./guards.js";

/** One item to add — shared by `add_grocery_items` and `add_recipe_to_grocery_list`. */
export const itemInputSchema = z.object({
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
 * Build the `GroceryItem`s for a batch add, resolving each item's aisle and
 * maintaining the ingredient catalog's aisle memory — the shared engine behind
 * `add_grocery_items` and `add_recipe_to_grocery_list` (which stamps `recipe`
 * with the linked recipe's name; a plain add passes `recipe: null`).
 *
 * An explicit `aisle` resolves via `ensureAisle` (auto-create) and upserts the
 * ingredient's catalog memory (POST + store + best-effort cache put); an omitted
 * one falls back batch-cache → catalog memory → the built-in Miscellaneous aisle.
 * Returns the built items, or the ready-to-return `CallToolResult` of the first
 * failure (an erring `ensureAisle` or a failed catalog save).
 */
export async function buildGroceryItems(
  // Declared at the helper's MINIMAL dependency need ("aisle") so both callers'
  // wider ctxs assign structurally; `Writes` stays defaulted (the helper never commits).
  ctx: DomainCtx<GroceryState, "aisle">,
  log: Logger,
  listUid: z.infer<typeof GroceryListUidSchema>,
  items: ReadonlyArray<z.infer<typeof itemInputSchema>>,
  recipe: string | null,
): Promise<Array<GroceryItem> | CallToolResult> {
  const builtItems: Array<GroceryItem> = [];
  const batchAisleCache = new Map<string, { aisle: string; aisleUid: AisleUid }>();
  const catalogUpdated = new Set<string>();
  for (const item of items) {
    const ingredient = item.ingredient;
    const ingredientKey = ingredient.toLowerCase();
    const quantity = item.quantity ?? "";
    const instruction = item.instruction ?? "";
    const uid = GroceryItemUidSchema.parse(crypto.randomUUID().toUpperCase());
    const name = quantity !== "" ? `${quantity} ${ingredient}` : ingredient;

    let aisle: string;
    let aisleUid: AisleUid;

    if (item.aisle !== undefined) {
      const resolved = (await ctx.deps.aisle.ensureAisle(item.aisle)).match(
        (v) => v,
        (message) => toolResult(message),
      );
      if ("content" in resolved) return resolved;
      aisle = resolved.aisle;
      aisleUid = resolved.aisleUid;
      batchAisleCache.set(ingredientKey, { aisle, aisleUid });

      if (!catalogUpdated.has(ingredientKey)) {
        catalogUpdated.add(ingredientKey);
        // Update (or create) the ingredient's catalog memory so the chosen
        // aisle sticks for future adds. The two branches differ only in the
        // entry they build; the save/commit tail is shared.
        const catalogEntry = ctx.state.ingredients.store.lookupByName(ingredient);
        const entry =
          catalogEntry !== undefined
            ? { ...catalogEntry, aisleUid }
            : {
                uid: GroceryIngredientUidSchema.parse(crypto.randomUUID().toUpperCase()),
                name: ingredient,
                aisleUid,
                deleted: false,
              };
        const catalogErr = (await ctx.infra.client.saveGroceryIngredient(entry)).match(
          () => undefined,
          (e) => {
            log.error({ err: e, listUid }, "saveGroceryIngredient failed");
            return toolResult(`Failed to add grocery items: ${e.message}`);
          },
        );
        if (catalogErr) return catalogErr;
        ctx.state.ingredients.store.set(entry);
        // The ingredient-catalog cache put is BEST-EFFORT: the save above
        // already landed the entry server-side, and the catalog is replace-all
        // synced, so a failed local put self-heals on the next cycle — warn
        // rather than failing an add whose grocery items will still commit.
        (await ctx.state.ingredients.cache.put(entry)).match(
          () => undefined,
          (e) => {
            log.warn({ err: e, ingredient }, "ingredient catalog cache put failed; next sync re-syncs it");
          },
        );
      }
    } else {
      const batchHit = batchAisleCache.get(ingredientKey);
      if (batchHit !== undefined) {
        aisle = batchHit.aisle;
        aisleUid = batchHit.aisleUid;
      } else {
        const catalogEntry = ctx.state.ingredients.store.lookupByName(ingredient);
        const resolvedAisle = catalogEntry !== undefined ? ctx.deps.aisle.get(catalogEntry.aisleUid) : undefined;
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
      listUid,
      purchased: false,
      deleted: false,
      orderFlag: 0,
      instruction,
      recipe,
      separate: false,
    };
    builtItems.push(built);
  }
  return builtItems;
}

/**
 * `add_grocery_items` — batch-add grocery items. Resolves aisles via the declared
 * `aisle` dependency contract (`ctx.deps.aisle.ensureAisle` / `.get` / `.resolveByName`) and
 * writes the grocery-ingredient catalog through this
 * module's OWN ingredient store + cache (`ctx.state.ingredients.*` — ingredient is a
 * co-owned grocery entity, so the catalog write stays in-module).
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
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "add_grocery_items" });
    return async (args) => {
      // Validate listUid (already brand-typed by the input schema)
      const list = ctx.state.lists.store.get(args.listUid);
      if (list === undefined) {
        return toolResult(`Grocery list with UID "${args.listUid}" not found.`);
      }

      // Validate all items (all-or-nothing before any API calls)
      for (const item of args.items) {
        if (item.ingredient.trim() === "") {
          return toolResult(`Invalid item: ingredient must not be empty.`);
        }
      }

      // Build all GroceryItem objects (aisle resolution + catalog memory), no recipe link.
      const builtItems = await buildGroceryItems(ctx, log, args.listUid, args.items, null);
      if ("content" in builtItems) return builtItems;

      // Single batch POST for all items
      const savedItems = (await ctx.infra.client.saveGroceryItems(builtItems)).match(
        (items) => items,
        (e) => {
          log.error({ err: e, listUid: args.listUid }, "saveGroceryItems failed");
          return toolResult(`Failed to add grocery items: ${e.message}`);
        },
      );
      if ("content" in savedItems) return savedItems;
      const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryItemsBatch(savedItems));
      if (commitErr) return commitErr;

      const count = savedItems.length;
      const rendered = savedItems.map((item) => groceryItemToMarkdown(item, ctx.deps.aisle)).join("\n\n---\n\n");
      return toolResult(`Added ${count.toString()} item(s) to the grocery list.\n\n${rendered}`);
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
 * `update_grocery_item` — edit a grocery item's free-form fields. Resolves a changed
 * aisle via `ctx.deps.aisle.ensureAisle`.
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
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "update_grocery_item" });
    return async (args) => {
      const existing = ctx.state.items.store.get(args.uid);
      if (existing === undefined) {
        return toolResult(`No grocery item found with UID "${args.uid}" (it may not exist or was already deleted).`);
      }

      const aisleUpdate =
        args.aisle !== undefined
          ? (await ctx.deps.aisle.ensureAisle(args.aisle)).match(
              (v) => v,
              (message) => toolResult(message),
            )
          : undefined;
      if (aisleUpdate !== undefined && "content" in aisleUpdate) return aisleUpdate;

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

      const saved = (await ctx.infra.client.saveGroceryItems([updated])).match(
        (items) => items[0]!,
        (e) => {
          log.error({ err: e, uid: args.uid }, "saveGroceryItems failed");
          return toolResult(`Failed to update grocery item: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;
      const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryItem(saved));
      if (commitErr) return commitErr;

      return toolResult(groceryItemToMarkdown(saved, ctx.deps.aisle));
    };
  },
);

/**
 * `delete_grocery_item` — remove a grocery item (soft-delete tombstone).
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
  [groceryStartGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "delete_grocery_item" });
    return async (args) => {
      const existing = ctx.state.items.store.get(args.uid);

      if (!existing) {
        return toolResult(`No grocery item found with UID "${args.uid}" (it may not exist or was already deleted).`);
      }

      const trashed = { ...existing, deleted: true };

      return (await ctx.infra.client.saveGroceryItems([trashed])).match(
        async (items) => {
          const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryItem(items[0]!));
          if (commitErr) return commitErr;
          return toolResult(`Grocery item "${existing.ingredient}" has been deleted.`);
        },
        async (e) => {
          log.error({ err: e, uid: args.uid }, "saveGroceryItems failed");
          return toolResult(`Failed to delete grocery item: ${e.message}`);
        },
      );
    };
  },
);
