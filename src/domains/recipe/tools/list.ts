import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { errorResult, structuredResult } from "../../../shared/tools.js";
import { listRecipesOutputSchema, recipeToRow } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

/**
 * `list_recipes` — list recipes. The `lastCookedAt` enrichment is DROPPED — recipe is
 * `dependsOn []` (no meal dependency); "last cooked" stays meal-side,
 * surfaced by the meal domain's `read_recipe_history` tool.
 */
export const listRecipesTool = defineTool(
  {
    name: "list_recipes",
    title: "List your saved recipes",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "List all recipes with pagination. Returns recipe summaries sorted alphabetically. Use offset/limit to paginate through the full library. Response includes total recipe count.",
    inputSchema: {
      offset: z.number().int().nonnegative().optional().default(0).describe("Number of recipes to skip (default: 0)"),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .default(25)
        .describe("Maximum number of recipes to return (default: 25, max: 50)"),
    },
    outputSchema: listRecipesOutputSchema,
    // Hosts with the apps surface render this result as the recipe-browser widget; others
    // show the text/structured result unchanged.
    ui: { resourceUri: "ui://widget/recipe-browser" },
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never>) => {
    return async (args) => {
      const all = ctx.state.recipe.store.getAll().sort((a, b) => a.name.localeCompare(b.name));
      const total = all.length;
      const page = all.slice(args.offset, args.offset + args.limit);

      if (page.length === 0) {
        // total 0 = an empty library (a valid empty success); a non-empty library
        // with an empty page = an over-paged offset (bad input → isError + hint),
        // the same split search_meal_history makes.
        if (total === 0) {
          return structuredResult({ context: { source: "list" }, items: [], total: 0, offset: args.offset });
        }
        return errorResult(
          `No recipes at offset ${args.offset.toString()} of ${total.toString()} total. ` +
            `Try a lower offset (the last page starts at offset ${Math.max(0, total - args.limit).toString()}).`,
        );
      }

      // Resolve each recipe's category names once into the structured rows.
      const rows = page.map((recipe) => recipeToRow(recipe, ctx.state.category.store.resolveNames(recipe.categories)));

      return structuredResult({ context: { source: "list" }, items: rows, total, offset: args.offset });
    };
  },
);
