import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { RecipeUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
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
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "rate_recipe" });
    return async (args) => {
      log.info({ tool: "rate_recipe", uid: args.uid }, "tool invoked");
      return recipeColdStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.recipe.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}" (it may not exist or was already deleted).`);
          }

          const updated = { ...existing, rating: args.rating };

          let saved: typeof existing;
          try {
            saved = await ctx.infra.client.saveRecipe(updated);
            const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), { selfHealing: false });
            if (commitErr) return commitErr;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to rate recipe: ${message}`);
          }

          const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    };
  },
);
