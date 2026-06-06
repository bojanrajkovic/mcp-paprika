import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { RecipeUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { recipeColdStartGuard } from "./guards.js";

/**
 * `trash_recipe` — move a recipe to the trash (a reversible soft-delete;
 * `restore_recipe` brings it back).
 */
export const trashRecipeTool = defineTool(
  {
    name: "trash_recipe",
    title: "Move a recipe to the trash",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    description:
      "Soft-delete a recipe by UID, moving it to the Paprika trash. " +
      "This operation is reversible — trashed recipes can be recovered in the Paprika app. " +
      "Requires an exact UID; fuzzy title matching is not supported to prevent accidental deletion.",
    inputSchema: {
      uid: RecipeUidSchema.describe("Recipe UID to delete"),
    },
  },
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "trash_recipe" });
    return async (args) => {
      log.info({ tool: "trash_recipe", uid: args.uid }, "tool invoked");
      return recipeColdStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const recipe = ctx.state.recipe.store.get(args.uid);

          if (!recipe) {
            return textResult(`No recipe found with UID "${args.uid}" (it may not exist or was already deleted).`);
          }

          if (recipe.inTrash) {
            return textResult(`Recipe "${recipe.name}" is already in the trash.`);
          }

          const trashed = { ...recipe, inTrash: true };

          try {
            const saved = await ctx.infra.client.saveRecipe(trashed);
            const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), { selfHealing: false });
            if (commitErr) return commitErr;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to delete recipe: ${message}`);
          }

          return textResult(`Recipe "${recipe.name}" has been moved to the trash.`);
        },
        (guard) => guard,
      );
    };
  },
);
