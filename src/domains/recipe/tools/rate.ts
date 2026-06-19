import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, toolResult } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../ids.js";
import { recipeToMarkdown } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

export const rateRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID to rate"),
    rating: z.number().int().min(0).max(5).describe("Star rating 0–5; 0 clears the rating"),
  })
  .strict();

/** `rate_recipe` — set a recipe's star rating. */
export const rateRecipeTool = defineTool(
  {
    name: "rate_recipe",
    title: "Rate a recipe",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Rate a recipe 0–5 stars by UID. Sets the recipe's star rating; pass 0 to clear it.",
    inputSchema: rateRecipeInputSchema,
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "rate_recipe" });
    return async (args) => {
      const existing = ctx.state.recipe.store.get(args.uid);

      if (!existing) {
        return toolResult(`No recipe found with UID "${args.uid}" (it may not exist or was already deleted).`);
      }

      const updated = { ...existing, rating: args.rating };

      const saved = (await ctx.infra.client.saveRecipe(updated)).match(
        (v) => v,
        (e) => {
          log.error({ err: e, uid: args.uid }, "saveRecipe failed");
          return toolResult(`Failed to rate recipe: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;
      const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), { selfHealing: false });
      if (commitErr) return commitErr;

      const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
      return toolResult(recipeToMarkdown(saved, categoryNames));
    };
  },
);
