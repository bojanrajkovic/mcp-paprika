import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";

import { RecipeUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { recipeColdStartGuard } from "./guards.js";

/** Registers `trash_recipe`, kernel-shaped — soft-delete through `ctx.self.commitRecipe`. */
export function trashRecipeTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "trash_recipe" });
  ctx.server.registerTool(
    "trash_recipe",
    {
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
    async (args) => {
      log.info({ tool: "trash_recipe", uid: args.uid }, "tool invoked");
      return recipeColdStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const recipe = ctx.self.recipe.store.get(args.uid);

          if (!recipe) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          if (recipe.inTrash) {
            return textResult(`Recipe "${recipe.name}" is already in the trash.`);
          }

          const trashed = { ...recipe, inTrash: true };

          try {
            const saved = await ctx.infra.client.saveRecipe(trashed);
            await ctx.self.commitRecipe(saved);
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
