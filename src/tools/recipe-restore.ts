import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { ServerContext } from "../types/server-context.js";

import { RecipeUidSchema } from "../ids.js";
import { toMessage } from "../utils/log.js";
import { coldStartGuard, commitRecipe, recipeToMarkdown, textResult } from "./helpers.js";

export const restoreRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID to restore from trash"),
  })
  .strict();

export function registerRestoreRecipeTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "restore_recipe" });
  server.registerTool(
    "restore_recipe",
    {
      description:
        "Restore a trashed recipe by UID, moving it out of the trash back into the active library. " +
        "The inverse of trash_recipe; use purge_recipe to permanently delete a trashed recipe instead.",
      inputSchema: restoreRecipeInputSchema,
    },
    async (args) => {
      log.info({ tool: "restore_recipe", uid: args.uid }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          if (!existing.inTrash) {
            return textResult(`Recipe "${existing.name}" is already in your active library.`);
          }

          const updated = { ...existing, inTrash: false };

          let saved: typeof existing;
          try {
            saved = await ctx.client.saveRecipe(updated);
            await commitRecipe(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to restore recipe: ${message}`);
          }

          const categoryNames = ctx.categoryStore.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    },
  );
}
