import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { CategoryUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";
import type { Recipe } from "../types.js";

import { CategoryUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { categoryStartGuard } from "./guards.js";

/**
 * Recipes that reference the given category UID — INCLUDING trashed ones. The
 * `delete_category` guard blocks on these so deleting a category can't leave a
 * dangling UID on a recipe the user later restores from the trash.
 */
function recipesReferencing(state: RecipeState, uid: CategoryUid): Array<Recipe> {
  return state.recipe.store.getAllIncludingTrashed().filter((recipe) => recipe.categories.includes(uid));
}

/**
 * `delete_category` — delete a category, guarding on within-domain recipe/child
 * references first.
 */
export const deleteCategoryTool = defineTool(
  {
    name: "delete_category",
    title: "Delete a recipe category",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Delete a category. Refuses if the category still has child categories or is assigned to any recipe — " +
      "reassign or delete those first (move recipes with `update_recipe`, re-parent children with " +
      "`update_category`). This keeps the hierarchy and recipe links consistent.",
    inputSchema: {
      uid: CategoryUidSchema.describe("UID of the category to delete"),
    },
  },
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "delete_category" });
    return async (args) => {
      log.info({ tool: "delete_category", uid: args.uid }, "tool invoked");
      return categoryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.category.store.get(args.uid);
          if (existing === undefined) {
            return textResult(`No category found with UID "${args.uid}" (it may not exist or was already deleted).`);
          }

          const children = ctx.state.category.store.getChildren(args.uid);
          if (children.length > 0) {
            const names = children.map((c) => `"${c.name}"`).join(", ");
            return textResult(
              `Cannot delete "${existing.name}": it has ${String(children.length)} child ` +
                `categor${children.length === 1 ? "y" : "ies"} (${names}). Re-parent or delete ${
                  children.length === 1 ? "it" : "them"
                } first with \`update_category\`.`,
            );
          }

          const refs = recipesReferencing(ctx.state, args.uid);
          if (refs.length > 0) {
            return textResult(
              `Cannot delete "${existing.name}": ${String(refs.length)} recipe${refs.length === 1 ? " is" : "s are"} ` +
                `still assigned to it. Reassign ${refs.length === 1 ? "that recipe" : "those recipes"} with ` +
                `\`update_recipe\` first.`,
            );
          }

          return (await ctx.infra.client.deleteCategory(existing)).match(
            async (): Promise<CallToolResult> => {
              const commitErr = commitFailure("category", await ctx.writes.commitCategoryDelete(existing));
              if (commitErr) return commitErr;
              return textResult(`Deleted category "${existing.name}".`);
            },
            async (e) => {
              log.error({ err: e, uid: args.uid }, "deleteCategory failed");
              return textResult(`Failed to delete category: ${e.message}`);
            },
          );
        },
        (guard) => guard,
      );
    };
  },
);
