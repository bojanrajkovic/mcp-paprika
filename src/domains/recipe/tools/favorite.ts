import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";

import { RecipeUidSchema } from "../../../ids.js";
import { recipeToMarkdown, textResult } from "../../../tools/helpers.js";
import { toMessage } from "../../../utils/log.js";
import { recipeColdStartGuard } from "./guards.js";

export const favoriteRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID"),
  })
  .strict();

export const unfavoriteRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID"),
  })
  .strict();

/** Registers `favorite_recipe`, kernel-shaped — writes through `ctx.self.commitRecipe`. */
export function favoriteRecipeTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "favorite_recipe" });
  ctx.server.registerTool(
    "favorite_recipe",
    {
      title: "Mark a recipe as a favorite",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Mark a recipe as a favorite by UID (adds it to the Favorites list).",
      inputSchema: favoriteRecipeInputSchema,
    },
    async (args) => {
      log.info({ tool: "favorite_recipe", uid: args.uid }, "tool invoked");
      return recipeColdStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.self.recipe.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          const updated = { ...existing, onFavorites: true };

          let saved: typeof existing;
          try {
            saved = await ctx.infra.client.saveRecipe(updated);
            await ctx.self.commitRecipe(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to favorite recipe: ${message}`);
          }

          const categoryNames = ctx.self.category.store.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    },
  );
}

/** Registers `unfavorite_recipe`, kernel-shaped — writes through `ctx.self.commitRecipe`. */
export function unfavoriteRecipeTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "unfavorite_recipe" });
  ctx.server.registerTool(
    "unfavorite_recipe",
    {
      title: "Remove a recipe from favorites",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Remove a recipe from the Favorites list by UID.",
      inputSchema: unfavoriteRecipeInputSchema,
    },
    async (args) => {
      log.info({ tool: "unfavorite_recipe", uid: args.uid }, "tool invoked");
      return recipeColdStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.self.recipe.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          const updated = { ...existing, onFavorites: false };

          let saved: typeof existing;
          try {
            saved = await ctx.infra.client.saveRecipe(updated);
            await ctx.self.commitRecipe(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to unfavorite recipe: ${message}`);
          }

          const categoryNames = ctx.self.category.store.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    },
  );
}

/** Both favorite-state registrars, in registration order. */
export const favoriteRecipeTools = [favoriteRecipeTool, unfavoriteRecipeTool];
