import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, toolResult } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../ids.js";
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
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "trash_recipe" });
    return async (args) => {
      const recipe = ctx.state.recipe.store.get(args.uid);

      if (!recipe) {
        return toolResult(
          `No recipe found with UID "${args.uid}" (it may not exist or was already deleted). Use \`search_recipes\` to find it.`,
        );
      }

      if (recipe.inTrash) {
        return toolResult(`Recipe "${recipe.name}" is already in the trash.`);
      }

      const trashed = { ...recipe, inTrash: true };

      return (await ctx.infra.client.saveRecipe(trashed)).match(
        async (saved): Promise<CallToolResult> => {
          const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), { selfHealing: false });
          if (commitErr) return commitErr;
          return toolResult(`Recipe "${recipe.name}" has been moved to the trash.`);
        },
        async (e) => {
          log.error({ err: e, uid: args.uid }, "saveRecipe failed");
          return toolResult(`Failed to delete recipe: ${e.message}`);
        },
      );
    };
  },
);
