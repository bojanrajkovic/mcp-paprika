import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";
import type { Recipe } from "../types.js";

import { RecipeUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { PaprikaAPIError } from "../../../paprika/errors.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { recipeToMarkdown } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

export const restoreRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID to restore from trash"),
  })
  .strict();

/**
 * `restore_recipe` — bring a trashed recipe back. Fetches authoritative trash state
 * via `ctx.infra.client.getRecipe`, then commits or reconciles the local copy.
 */
export const restoreRecipeTool = defineTool(
  {
    name: "restore_recipe",
    title: "Restore a recipe from the trash",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description:
      "Restore a trashed recipe by UID, moving it out of the trash back into the active library. " +
      "The inverse of trash_recipe; use purge_recipe to permanently delete a trashed recipe instead.",
    inputSchema: restoreRecipeInputSchema,
  },
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "restore_recipe" });
    return async (args) => {
      log.info({ tool: "restore_recipe", uid: args.uid }, "tool invoked");
      return recipeColdStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          // Fetch authoritative trash state from Paprika rather than the local store,
          // mirroring purge_recipe. A recipe trashed in the Paprika app reaches this
          // server's store only on the next sync cycle, so a local-only lookup could
          // return a stale inTrash:false — or nothing at all — and wrongly refuse to
          // restore a recipe that is genuinely sitting in the trash. getRecipe is the
          // source of truth for inTrash.
          let recipe: Recipe;
          try {
            recipe = await ctx.infra.client.getRecipe(args.uid);
          } catch (error) {
            if (error instanceof PaprikaAPIError && error.status === 404) {
              // Never existed, or already permanently purged from the trash. Drop a
              // stale local phantom so a later read/search can't serve it.
              log.info({ uid: args.uid }, "restore_recipe: recipe not found (404)");
              await ctx.writes.reconcileLocalRecipeAbsent(args.uid);
              return textResult(`No recipe found with UID "${args.uid}" (it may not exist or was already deleted).`);
            }
            // Transient/upstream failure — don't masquerade as "already active".
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "restore_recipe lookup failed");
            return textResult(`Failed to look up recipe "${args.uid}": ${message}`);
          }

          if (!recipe.inTrash) {
            // Authoritative truth: it's live. Heal a stale local copy that still shows
            // it trashed (or is missing) so reads/search agree before the next sync.
            await ctx.writes.reconcileLocalRecipe(recipe);
            return textResult(`Recipe "${recipe.name}" is already in your active library.`);
          }

          // A pure inTrash flip; saveRecipe's hash recompute is a no-op (the hash is
          // trash-independent), so the restored recipe round-trips verbatim.
          const updated = { ...recipe, inTrash: false };

          let saved: Recipe;
          try {
            saved = await ctx.infra.client.saveRecipe(updated);
            const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), { selfHealing: false });
            if (commitErr) return commitErr;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to restore recipe: ${message}`);
          }

          const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
          return textResult(recipeToMarkdown(saved, categoryNames));
        },
        (guard) => guard,
      );
    };
  },
);
