import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RecipeUidSchema } from "../ids.js";
import { coldStartGuard, commitRecipe, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerDeleteTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "delete_recipe" });
  server.registerTool(
    "delete_recipe",
    {
      description:
        "Soft-delete a recipe by UID, moving it to the Paprika trash. " +
        "This operation is reversible — trashed recipes can be recovered in the Paprika app. " +
        "Requires an exact UID; fuzzy title matching is not supported to prevent accidental deletion.",
      inputSchema: {
        uid: RecipeUidSchema.describe("Recipe UID to delete"),
      },
    },
    async (args) => {
      log.info({ tool: "delete_recipe", uid: args.uid }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const recipe = ctx.store.get(args.uid);

          if (!recipe) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          if (recipe.inTrash) {
            return textResult(`Recipe "${recipe.name}" is already in the trash.`);
          }

          const trashed = { ...recipe, inTrash: true };

          try {
            const saved = await ctx.client.saveRecipe(trashed);
            await commitRecipe(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to delete recipe: ${message}`);
          }

          return textResult(`Recipe "${recipe.name}" has been moved to the trash.`);
        },
        (guard) => guard,
      );
    },
  );
}
