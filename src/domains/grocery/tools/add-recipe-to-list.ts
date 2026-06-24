import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryList } from "../grocery-list/types.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import {
  commitFailure,
  errorResult,
  resolveLookup,
  resolveOrPick,
  structuredResult,
  uidOrTextLookupSchema,
} from "../../../shared/tools.js";
import { RecipeUidSchema } from "../../recipe/ids.js";
import { groceryItemsToRows } from "../grocery-helpers.js";
import { GroceryListUidSchema } from "../ids.js";
import { addGroceryItemsOutputSchema, buildGroceryItems, itemInputSchema } from "./grocery-item.js";
import { groceryStartGuard, recipeSyncedGuard } from "./guards.js";

const recipeLookupSchema = uidOrTextLookupSchema({
  uidSchema: RecipeUidSchema,
  textKey: "title",
  entityLabel: "recipe",
  textExample: "Pad Thai",
});

/**
 * `add_recipe_to_grocery_list` — the cross-entity act behind the app's one-tap
 * "add to grocery list": create grocery items for a recipe's ingredients, each
 * carrying the recipe's NAME as its `recipe` link (the wire links by name, not
 * UID). The AGENT parses the recipe's free-text `ingredients` blob into items —
 * the engine embeds no ingredient NLP; aisle resolution and the
 * ingredient catalog's aisle memory ride the same `buildGroceryItems` engine as
 * `add_grocery_items`.
 *
 * Duplicate guard: items whose ingredient already sits UNPURCHASED on the target
 * list (case-insensitive) are skipped and reported — re-adding something bought
 * last week is legitimate, so purchased items don't count. The recipe's
 * `on_grocery_list` flag is deliberately untouched: keeping it truthful would
 * need a grocery→recipe write on every item delete/clear, and the flag remains
 * remote-managed instead.
 */
export const addRecipeToGroceryListTool = defineTool(
  {
    name: "add_recipe_to_grocery_list",
    title: "Add a recipe's ingredients to a grocery list",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    description:
      "Add a recipe's ingredients to a grocery list as linked grocery items. Parse the recipe's ingredient " +
      "lines into the `items` array (one entry per ingredient, quantity separated out). Ingredients already " +
      "on the list unpurchased are skipped and reported with their UID and a hint to use update_grocery_item to merge quantities. Omit `listUid` to use the default grocery list.",
    inputSchema: {
      recipe: recipeLookupSchema.describe("The recipe to link: exact UID or title lookup"),
      listUid: GroceryListUidSchema.optional().describe(
        "Target grocery list UID; omit to use the default list (see list_grocery_lists)",
      ),
      items: z
        .array(itemInputSchema)
        .min(1)
        .describe("The recipe's ingredients, parsed: one entry per ingredient line"),
    },
    outputSchema: addGroceryItemsOutputSchema,
  },
  [groceryStartGuard, recipeSyncedGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry" | "recipe", GroceryWrites>) => {
    const log = ctx.infra.log.child({ component: "add_recipe_to_grocery_list" });
    return async (args) => {
      // Resolve the recipe (uid-or-title) through the recipe contract.
      const query = "uid" in args.recipe ? { uid: args.recipe.uid } : { text: args.recipe.title };
      const outcome = resolveLookup(query, {
        get: (uid) => ctx.deps.recipe.get(uid),
        findByText: (text) => ctx.deps.recipe.findByName(text),
      });
      const resolved = await resolveOrPick(ctx.server.server, outcome, {
        entityNoun: "recipe",
        describe: (r) => ({ uid: r.uid, label: r.name }),
        findWith: "search_recipes",
        log,
      });
      if ("result" in resolved) return resolved.result;
      const recipe = resolved.entity;

      // Validate all items before any API calls (all-or-nothing, mirroring
      // add_grocery_items): min(1) admits whitespace-only ingredients.
      for (const item of args.items) {
        if (item.ingredient.trim() === "") {
          return errorResult(`Invalid item: ingredient must not be empty.`);
        }
      }

      // Resolve the target list: explicit UID, or the default list.
      let list: GroceryList | undefined;
      if (args.listUid !== undefined) {
        list = ctx.state.lists.store.get(args.listUid);
        if (list === undefined) {
          return errorResult(`Grocery list with UID "${args.listUid}" not found.`);
        }
      } else {
        list = ctx.state.lists.store.getAll().find((l) => l.isDefault);
        if (list === undefined) {
          return errorResult("No default grocery list found — pass `listUid` (see list_grocery_lists).");
        }
      }
      const listUid = list.uid;

      // Skip ingredients already on the list unpurchased (case-insensitive); report each
      // with its UID so the model can call update_grocery_item to merge quantities.
      const onList = new Map(
        ctx.state.items.store
          .getByListUid(listUid)
          .filter((i) => !i.purchased)
          .map((i) => [i.ingredient.toLowerCase(), i.uid] as const),
      );
      const toAdd: Array<(typeof args.items)[number]> = [];
      const skipMessages: Array<string> = [];
      for (const item of args.items) {
        const existingUid = onList.get(item.ingredient.toLowerCase());
        if (existingUid !== undefined) {
          skipMessages.push(`"${item.ingredient}" (UID: ${existingUid}) — use update_grocery_item to merge quantities`);
        } else {
          toAdd.push(item);
        }
      }
      if (toAdd.length === 0) {
        // Empty-but-valid success: nothing was created, so the structured payload
        // is the target list with an empty item array (NOT an error — the input was
        // fine and the act succeeded with zero new items). `skipped` carries the
        // already-on-the-list notices.
        return structuredResult({ listUid, items: [], skipped: skipMessages });
      }

      const builtItems = await buildGroceryItems(ctx, log, listUid, toAdd, recipe.name);
      if ("content" in builtItems) return builtItems;

      const savedItems = (await ctx.infra.client.saveGroceryItems(builtItems)).match(
        (items) => items,
        (e) => {
          log.error({ err: e, listUid }, "saveGroceryItems failed");
          return errorResult(`Failed to add grocery items: ${e.message}`);
        },
      );
      if ("content" in savedItems) return savedItems;

      // The new child UIDs ride structuredContent (and the degraded commit branch),
      // so the model can chain mark_grocery_item_purchased / update_grocery_item
      // without a re-read; `skipped` carries any already-on-the-list notices.
      const structured = { listUid, items: groceryItemsToRows(savedItems, ctx.deps.aisle), skipped: skipMessages };
      const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryItemsBatch(savedItems), {
        structuredContent: structured,
      });
      if (commitErr) return commitErr;

      return structuredResult(structured);
    };
  },
);
