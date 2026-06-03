import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerContext } from "../types/server-context.js";

import { RecipeUidSchema } from "../ids.js";
import { toMessage } from "../utils/log.js";
import { coldStartGuard, commitRecipe, recipeToMarkdown, textResult } from "./helpers.js";

export const rateRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID to rate"),
    rating: z.number().int().min(0).max(5).describe("Star rating 0–5; 0 clears the rating"),
  })
  .strict();

export function registerRateRecipeTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "rate_recipe" });
  server.registerTool(
    "rate_recipe",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description: "Rate a recipe 0–5 stars by UID. Sets the recipe's star rating; pass 0 to clear it.",
      inputSchema: rateRecipeInputSchema,
    },
    async (args) => {
      log.info({ tool: "rate_recipe", uid: args.uid }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          const updated = { ...existing, rating: args.rating };

          let saved: typeof existing;
          try {
            saved = await ctx.client.saveRecipe(updated);
            await commitRecipe(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to rate recipe: ${message}`);
          }

          const categoryNames = ctx.categoryStore.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    },
  );
}
