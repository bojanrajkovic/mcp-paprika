import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryList } from "../grocery-list/types.js";
import type { GroceryState, GroceryWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, resolveLookup, textResult, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../../recipe/ids.js";
import { groceryItemToMarkdown } from "../grocery-helpers.js";
import { GroceryListUidSchema } from "../ids.js";
import { buildGroceryItems, itemInputSchema } from "./grocery-item.js";
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
      "on the list unpurchased are skipped and reported. Omit `listUid` to use the default grocery list.",
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
      if (outcome.kind === "uid_miss") {
        return textResult(`No recipe found with UID "${outcome.uid}".`);
      }
      if (outcome.kind === "text_none") {
        return textResult(`No recipes found matching "${outcome.text}".`);
      }
      if (outcome.kind === "text_many") {
        const lines = outcome.matches.map((r) => `- **${r.name}** — \`${r.uid}\``);
        return textResult(
          `Multiple recipes match "${outcome.text}" — retry with the UID of the one you mean:\n${lines.join("\n")}`,
        );
      }
      const recipe = outcome.entity;

      // Validate all items before any API calls (all-or-nothing, mirroring
      // add_grocery_items): min(1) admits whitespace-only ingredients.
      for (const item of args.items) {
        if (item.ingredient.trim() === "") {
          return textResult(`Invalid item: ingredient must not be empty.`);
        }
      }

      // Resolve the target list: explicit UID, or the default list.
      let list: GroceryList | undefined;
      if (args.listUid !== undefined) {
        list = ctx.state.lists.store.get(args.listUid);
        if (list === undefined) {
          return textResult(`Grocery list with UID "${args.listUid}" not found.`);
        }
      } else {
        list = ctx.state.lists.store.getAll().find((l) => l.isDefault);
        if (list === undefined) {
          return textResult("No default grocery list found — pass `listUid` (see list_grocery_lists).");
        }
      }
      const listUid = list.uid;

      // Skip ingredients already on the list unpurchased (case-insensitive).
      // One partition pass so the membership test lives in exactly one place.
      const onList = new Set(
        ctx.state.items.store
          .getByListUid(listUid)
          .filter((i) => !i.purchased)
          .map((i) => i.ingredient.toLowerCase()),
      );
      const toAdd: Array<(typeof args.items)[number]> = [];
      const skipped: Array<(typeof args.items)[number]> = [];
      for (const item of args.items) {
        (onList.has(item.ingredient.toLowerCase()) ? skipped : toAdd).push(item);
      }
      const skippedNote =
        skipped.length > 0 ? `\n\nAlready on the list (skipped): ${skipped.map((i) => i.ingredient).join(", ")}.` : "";
      if (toAdd.length === 0) {
        return textResult(
          `Nothing to add — every ingredient from "${recipe.name}" is already on "${list.name}" unpurchased.` +
            skippedNote,
        );
      }

      const builtItems = await buildGroceryItems(ctx, log, listUid, toAdd, recipe.name);
      if ("content" in builtItems) return builtItems;

      const savedItems = (await ctx.infra.client.saveGroceryItems(builtItems)).match(
        (items) => items,
        (e) => {
          log.error({ err: e, listUid }, "saveGroceryItems failed");
          return textResult(`Failed to add grocery items: ${e.message}`);
        },
      );
      if ("content" in savedItems) return savedItems;
      const commitErr = commitFailure("grocery list", await ctx.writes.commitGroceryItemsBatch(savedItems));
      if (commitErr) return commitErr;

      const rendered = savedItems.map((item) => groceryItemToMarkdown(item, ctx.deps.aisle)).join("\n\n---\n\n");
      return textResult(
        `Added ${String(savedItems.length)} item(s) from "${recipe.name}" to "${list.name}".${skippedNote}\n\n${rendered}`,
      );
    };
  },
);
