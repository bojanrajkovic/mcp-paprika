import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerContext } from "../types/server-context.js";

import { RecipeUidSchema } from "../ids.js";
import { toMessage } from "../utils/log.js";
import { coldStartGuard, commitRecipe, recipeToMarkdown, textResult } from "./helpers.js";

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

export function registerFavoriteRecipeTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "favorite_recipe" });
  server.registerTool(
    "favorite_recipe",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Mark a recipe as a favorite by UID (adds it to the Favorites list).",
      inputSchema: favoriteRecipeInputSchema,
    },
    async (args) => {
      log.info({ tool: "favorite_recipe", uid: args.uid }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          const updated = { ...existing, onFavorites: true };

          let saved: typeof existing;
          try {
            saved = await ctx.client.saveRecipe(updated);
            await commitRecipe(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to favorite recipe: ${message}`);
          }

          const categoryNames = ctx.categoryStore.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    },
  );
}

export function registerUnfavoriteRecipeTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "unfavorite_recipe" });
  server.registerTool(
    "unfavorite_recipe",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Remove a recipe from the Favorites list by UID.",
      inputSchema: unfavoriteRecipeInputSchema,
    },
    async (args) => {
      log.info({ tool: "unfavorite_recipe", uid: args.uid }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          const updated = { ...existing, onFavorites: false };

          let saved: typeof existing;
          try {
            saved = await ctx.client.saveRecipe(updated);
            await commitRecipe(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to unfavorite recipe: ${message}`);
          }

          const categoryNames = ctx.categoryStore.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    },
  );
}
