import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { Recipe } from "../recipe/types.js";
import type { ServerContext } from "../types/server-context.js";

import { RecipeUidSchema } from "../ids.js";
import { PaprikaAPIError } from "../paprika/errors.js";
import { toMessage } from "../utils/log.js";
import { coldStartGuard, commitRecipeHardDelete, textResult } from "./helpers.js";

export function registerEmptyTrashTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "empty_trash" });
  server.registerTool(
    "empty_trash",
    {
      description:
        "Permanently delete a recipe that is already in the Paprika trash. " +
        "This is IRREVERSIBLE — once emptied from the trash the recipe cannot be recovered. " +
        "The recipe must first be moved to the trash with delete_recipe (a reversible soft-delete); " +
        "empty_trash refuses to permanently delete a recipe that is not already trashed, so an " +
        "accidental call can never destroy a live recipe in one step. " +
        "Requires an exact UID; fuzzy title matching is not supported, to prevent accidental loss.",
      inputSchema: {
        uid: RecipeUidSchema.describe("UID of a trashed recipe to permanently delete"),
      },
    },
    async (args) => {
      log.info({ tool: "empty_trash", uid: args.uid }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Fetch authoritative state from Paprika rather than the local store. A
          // recipe trashed in the Paprika app reaches this server's store only on the
          // next sync cycle (and one trashed before this feature shipped may never
          // have loaded as trashed), so a local-only lookup could return a stale
          // inTrash:false — or nothing at all — and wrongly refuse a genuinely
          // trashed recipe. getRecipe is the source of truth for inTrash (#125).
          let recipe: Recipe;
          try {
            recipe = await ctx.client.getRecipe(args.uid);
          } catch (error) {
            if (error instanceof PaprikaAPIError && error.status === 404) {
              // Never existed, or already permanently deleted (trash emptied).
              log.info({ uid: args.uid }, "empty_trash: recipe not found (404)");
              return textResult(
                `No recipe found with UID "${args.uid}". It may have already been permanently deleted.`,
              );
            }
            // Transient/upstream failure — don't masquerade as "already deleted".
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "empty_trash lookup failed");
            return textResult(`Failed to look up recipe "${args.uid}": ${message}`);
          }

          if (!recipe.inTrash) {
            return textResult(
              `Recipe "${recipe.name}" is not in the trash, so it can't be permanently deleted. ` +
                `Move it to the trash first with delete_recipe (reversible), then call empty_trash.`,
            );
          }

          // Same wire shape as a soft-delete (in_trash: true) plus deleted: true —
          // the exact "empty trash" payload Paprika.app emits. The recipe's hash and
          // created round-trip verbatim from the fetched recipe.
          const tombstone = { ...recipe, inTrash: true, deleted: true };

          try {
            const saved = await ctx.client.saveRecipe(tombstone);
            await commitRecipeHardDelete(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "hard-delete saveRecipe failed");
            return textResult(`Failed to permanently delete recipe: ${message}`);
          }

          return textResult(`Recipe "${recipe.name}" has been permanently deleted from the trash.`);
        },
        (guard) => guard,
      );
    },
  );
}
