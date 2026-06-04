import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { CategoryUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";
import type { Recipe } from "../types.js";

import { CategoryUidSchema } from "../../../ids.js";
import { textResult } from "../../../tools/helpers.js";
import { toMessage } from "../../../utils/log.js";
import { categoryStartGuard } from "./guards.js";

/**
 * Recipes that reference the given category UID — INCLUDING trashed ones. The
 * `delete_category` guard blocks on these so deleting a category can't leave a
 * dangling UID on a recipe the user later restores from the trash. Within the
 * collapsed recipe domain the recipe store is `self` (no cross-domain reach).
 */
function recipesReferencing(self: RecipeSelf, uid: CategoryUid): Array<Recipe> {
  return self.recipe.store.getAllIncludingTrashed().filter((recipe) => recipe.categories.includes(uid));
}

/** Registers `delete_category`, kernel-shaped — guards on within-domain recipe/child refs, deletes through `ctx.self.commitCategoryDelete`. */
export function deleteCategoryTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "delete_category" });
  ctx.server.registerTool(
    "delete_category",
    {
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
    async (args) => {
      log.info({ tool: "delete_category", uid: args.uid }, "tool invoked");
      return categoryStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.self.category.store.get(args.uid);
          if (existing === undefined) {
            return textResult(`No category found with UID "${args.uid}" (already deleted?).`);
          }

          const children = ctx.self.category.store.getChildren(args.uid);
          if (children.length > 0) {
            const names = children.map((c) => `"${c.name}"`).join(", ");
            return textResult(
              `Cannot delete "${existing.name}": it has ${String(children.length)} child ` +
                `categor${children.length === 1 ? "y" : "ies"} (${names}). Re-parent or delete ${
                  children.length === 1 ? "it" : "them"
                } first with \`update_category\`.`,
            );
          }

          const refs = recipesReferencing(ctx.self, args.uid);
          if (refs.length > 0) {
            return textResult(
              `Cannot delete "${existing.name}": ${String(refs.length)} recipe${refs.length === 1 ? " is" : "s are"} ` +
                `still assigned to it. Reassign ${refs.length === 1 ? "that recipe" : "those recipes"} with ` +
                `\`update_recipe\` first.`,
            );
          }

          try {
            await ctx.infra.client.deleteCategory(existing);
            await ctx.self.commitCategoryDelete(existing);
            return textResult(`Deleted category "${existing.name}".`);
          } catch (error) {
            log.error({ err: error, uid: args.uid }, "deleteCategory failed");
            return textResult(`Failed to delete category: ${toMessage(error)}`);
          }
        },
        (guard) => guard,
      );
    },
  );
}
