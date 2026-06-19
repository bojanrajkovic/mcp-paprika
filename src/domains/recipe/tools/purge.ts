import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { PaprikaAPIError } from "../../../paprika/errors.js";
import { commitFailure, toolResult } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../ids.js";
import { recipeColdStartGuard } from "./guards.js";

/**
 * `purge_recipe` — empty-trash hard delete. Fetches authoritative state via
 * `ctx.infra.client.getRecipe`, then hard-deletes or reconciles the local copy
 * accordingly.
 */
export const purgeRecipeTool = defineTool(
  {
    name: "purge_recipe",
    title: "Permanently delete a trashed recipe",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    description:
      "Permanently delete a recipe that is already in the Paprika trash. " +
      "This is IRREVERSIBLE — once emptied from the trash the recipe cannot be recovered. " +
      "The recipe must first be moved to the trash with trash_recipe (a reversible soft-delete); " +
      "purge_recipe refuses to permanently delete a recipe that is not already trashed, so an " +
      "accidental call can never destroy a live recipe in one step. " +
      "Requires an exact UID; fuzzy title matching is not supported, to prevent accidental loss.",
    inputSchema: {
      uid: RecipeUidSchema.describe("UID of a trashed recipe to permanently delete"),
    },
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "purge_recipe" });
    return async (args) => {
      // Fetch authoritative state from Paprika rather than the local store. A
      // recipe trashed in the Paprika app reaches this server's store only on the
      // next sync cycle (and one trashed before this feature shipped may never
      // have loaded as trashed), so a local-only lookup could return a stale
      // inTrash:false — or nothing at all — and wrongly refuse a genuinely
      // trashed recipe. getRecipe is the source of truth for inTrash (#125).
      const recipe = await (
        await ctx.infra.client.getRecipe(args.uid)
      ).match(
        (v) => v,
        async (e): Promise<CallToolResult> => {
          if (e instanceof PaprikaAPIError && e.status === 404) {
            // Never existed, or already permanently deleted (trash emptied). Drop a
            // stale local phantom so a later read/search can't serve it.
            log.info({ uid: args.uid }, "purge_recipe: recipe not found (404)");
            await ctx.writes.reconcileLocalRecipeAbsent(args.uid);
            return toolResult(`No recipe found with UID "${args.uid}". It may have already been permanently deleted.`);
          }
          // Transient/upstream failure — don't masquerade as "already deleted".
          log.error({ err: e, uid: args.uid }, "purge_recipe lookup failed");
          return toolResult(`Failed to look up recipe "${args.uid}": ${e.message}`);
        },
      );
      if ("content" in recipe) return recipe;

      if (!recipe.inTrash) {
        // Authoritative truth: it's live. Heal a stale local copy that still shows
        // it trashed so reads/search agree before the next sync cycle.
        await ctx.writes.reconcileLocalRecipe(recipe);
        return toolResult(
          `Recipe "${recipe.name}" is not in the trash, so it can't be permanently deleted. ` +
            `Move it to the trash first with trash_recipe (reversible), then call purge_recipe.`,
        );
      }

      // Same wire shape as a soft-delete (in_trash: true) plus deleted: true —
      // the exact "empty trash" payload Paprika.app emits. The recipe's hash and
      // created round-trip verbatim from the fetched recipe.
      const tombstone = { ...recipe, inTrash: true, deleted: true };

      return (await ctx.infra.client.saveRecipe(tombstone)).match(
        async (saved): Promise<CallToolResult> => {
          const commitErr = commitFailure("recipe", await ctx.writes.commitRecipeHardDelete(saved), {
            selfHealing: false,
          });
          if (commitErr) return commitErr;
          return toolResult(`Recipe "${recipe.name}" has been permanently deleted from the trash.`);
        },
        async (e) => {
          log.error({ err: e, uid: args.uid }, "hard-delete saveRecipe failed");
          return toolResult(`Failed to permanently delete recipe: ${e.message}`);
        },
      );
    };
  },
);
