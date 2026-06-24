import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, errorResult, structuredResult } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../ids.js";
import { recipeReadOutputSchema, recipeToReadStructured } from "../recipe-markdown.js";
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
    outputSchema: recipeReadOutputSchema,
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "trash_recipe" });
    return async (args) => {
      const recipe = ctx.state.recipe.store.get(args.uid);

      if (!recipe) {
        return errorResult(
          `No recipe found with UID "${args.uid}" (it may not exist or was already deleted). Use \`search_recipes\` to find it.`,
        );
      }

      if (recipe.inTrash) {
        // A no-op success: the recipe is already where the caller wants it, so the
        // structured payload is the trashed recipe (NOT an error).
        const categoryNames = ctx.state.category.store.resolveNames(recipe.categories);
        return structuredResult(recipeToReadStructured(recipe, categoryNames));
      }

      const trashed = { ...recipe, inTrash: true };

      return (await ctx.infra.client.saveRecipe(trashed)).match(
        async (saved) => {
          // The ack keeps its prose, but the saved (now-trashed) recipe rides
          // structuredContent so a widget or the model can re-render the result —
          // deleted:true rides through fine.
          const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
          const structured = recipeToReadStructured(saved, categoryNames);
          const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), {
            structuredContent: structured,
            selfHealing: false,
          });
          if (commitErr) return commitErr;
          return structuredResult(structured);
        },
        async (e) => {
          log.error({ err: e, uid: args.uid }, "saveRecipe failed");
          return errorResult(`Failed to delete recipe: ${e.message}`);
        },
      );
    };
  },
);
