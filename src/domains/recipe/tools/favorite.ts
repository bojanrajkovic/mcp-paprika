import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { RecipeUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { recipeToMarkdown } from "../recipe-markdown.js";
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

/** `favorite_recipe` — mark a recipe as a favorite. */
export const favoriteRecipeTool = defineTool(
  {
    name: "favorite_recipe",
    title: "Mark a recipe as a favorite",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Mark a recipe as a favorite by UID (adds it to the Favorites list).",
    inputSchema: favoriteRecipeInputSchema,
  },
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "favorite_recipe" });
    return async (args) => {
      log.info({ tool: "favorite_recipe", uid: args.uid }, "tool invoked");
      return recipeColdStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.recipe.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}" (it may not exist or was already deleted).`);
          }

          const updated = { ...existing, onFavorites: true };

          let saved: typeof existing;
          try {
            saved = await ctx.infra.client.saveRecipe(updated);
            await ctx.writes.commitRecipe(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to favorite recipe: ${message}`);
          }

          const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    };
  },
);

/** `unfavorite_recipe` — remove a recipe from favorites. */
export const unfavoriteRecipeTool = defineTool(
  {
    name: "unfavorite_recipe",
    title: "Remove a recipe from favorites",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Remove a recipe from the Favorites list by UID.",
    inputSchema: unfavoriteRecipeInputSchema,
  },
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "unfavorite_recipe" });
    return async (args) => {
      log.info({ tool: "unfavorite_recipe", uid: args.uid }, "tool invoked");
      return recipeColdStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.recipe.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}" (it may not exist or was already deleted).`);
          }

          const updated = { ...existing, onFavorites: false };

          let saved: typeof existing;
          try {
            saved = await ctx.infra.client.saveRecipe(updated);
            await ctx.writes.commitRecipe(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to unfavorite recipe: ${message}`);
          }

          const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    };
  },
);

/** Both favorite-state registrars, in registration order. */
export const favoriteRecipeTools = [favoriteRecipeTool, unfavoriteRecipeTool];
