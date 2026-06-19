import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { formatLookupOutcome, resolveLookup, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../ids.js";
import { recipeToMarkdown } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

/**
 * `read_recipe` — read one recipe (with category names). The `lastCookedAt` argument
 * to `recipeToMarkdown` is DROPPED — recipe is `dependsOn []` (no meal dependency);
 * "last cooked" stays meal-side, surfaced by the meal domain's `read_recipe_history`
 * tool.
 */
export const readRecipeTool = defineTool(
  {
    name: "read_recipe",
    title: "Read a recipe by UID or title",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Read a recipe by UID or title. Title lookup is fuzzy (exact → starts-with → contains) " +
      "and returns a disambiguation list when multiple recipes match the same tier. " +
      'Pass exactly one shape: {"uid": "..."} or {"title": "..."}.',
    inputSchema: {
      lookup: uidOrTextLookupSchema({
        uidSchema: RecipeUidSchema,
        textKey: "title",
        entityLabel: "recipe",
        textExample: "Chocolate Cake",
      }),
    },
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never>) => {
    return async (args) => {
      const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.title };
      const outcome = resolveLookup(query, {
        get: (uid) => ctx.state.recipe.store.get(uid),
        findByText: (text) => ctx.state.recipe.store.findByName(text),
      });
      return formatLookupOutcome(ctx.server.server, outcome, {
        entityNoun: "recipe",
        describe: (recipe) => ({ uid: recipe.uid, label: recipe.name }),
        renderOne: (recipe) => recipeToMarkdown(recipe, ctx.state.category.store.resolveNames(recipe.categories)),
      });
    };
  },
);
