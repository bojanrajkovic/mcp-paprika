import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";

import { RecipeUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { recipeToMarkdown } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

export const rateRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID to rate"),
    rating: z.number().int().min(0).max(5).describe("Star rating 0–5; 0 clears the rating"),
  })
  .strict();

/** Registers `rate_recipe`, kernel-shaped — writes through `ctx.self.commitRecipe`. */
export function rateRecipeTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "rate_recipe" });
  ctx.server.registerTool(
    "rate_recipe",
    {
      title: "Rate a recipe",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Rate a recipe 0–5 stars by UID. Sets the recipe's star rating; pass 0 to clear it.",
      inputSchema: rateRecipeInputSchema,
    },
    async (args) => {
      log.info({ tool: "rate_recipe", uid: args.uid }, "tool invoked");
      return recipeColdStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.self.recipe.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          const updated = { ...existing, rating: args.rating };

          let saved: typeof existing;
          try {
            saved = await ctx.infra.client.saveRecipe(updated);
            await ctx.self.commitRecipe(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to rate recipe: ${message}`);
          }

          const categoryNames = ctx.self.category.store.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    },
  );
}
