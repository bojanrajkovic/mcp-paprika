import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Recipe } from "../recipe/types.js";
import type { ServerContext } from "../types/server-context.js";

import { RecipeUidSchema } from "../ids.js";
import { PaprikaAPIError } from "../paprika/errors.js";
import { toMessage } from "../utils/log.js";
import {
  coldStartGuard,
  commitRecipe,
  recipeToMarkdown,
  reconcileLocalRecipe,
  reconcileLocalRecipeAbsent,
  textResult,
} from "./helpers.js";

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
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description:
        "Restore a trashed recipe by UID, moving it out of the trash back into the active library. " +
        "The inverse of trash_recipe; use purge_recipe to permanently delete a trashed recipe instead.",
      inputSchema: restoreRecipeInputSchema,
    },
    async (args) => {
      log.info({ tool: "restore_recipe", uid: args.uid }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Fetch authoritative trash state from Paprika rather than the local store,
          // mirroring purge_recipe. A recipe trashed in the Paprika app reaches this
          // server's store only on the next sync cycle, so a local-only lookup could
          // return a stale inTrash:false — or nothing at all — and wrongly refuse to
          // restore a recipe that is genuinely sitting in the trash. getRecipe is the
          // source of truth for inTrash.
          let recipe: Recipe;
          try {
            recipe = await ctx.client.getRecipe(args.uid);
          } catch (error) {
            if (error instanceof PaprikaAPIError && error.status === 404) {
              // Never existed, or already permanently purged from the trash. Drop a
              // stale local phantom so a later read/search can't serve it.
              log.info({ uid: args.uid }, "restore_recipe: recipe not found (404)");
              await reconcileLocalRecipeAbsent(ctx, args.uid);
              return textResult(`No recipe found with UID "${args.uid}".`);
            }
            // Transient/upstream failure — don't masquerade as "already active".
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "restore_recipe lookup failed");
            return textResult(`Failed to look up recipe "${args.uid}": ${message}`);
          }

          if (!recipe.inTrash) {
            // Authoritative truth: it's live. Heal a stale local copy that still shows
            // it trashed (or is missing) so reads/search agree before the next sync.
            await reconcileLocalRecipe(ctx, recipe);
            return textResult(`Recipe "${recipe.name}" is already in your active library.`);
          }

          // A pure inTrash flip; saveRecipe's hash recompute is a no-op (the hash is
          // trash-independent), so the restored recipe round-trips verbatim.
          const updated = { ...recipe, inTrash: false };

          let saved: Recipe;
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
