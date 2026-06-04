import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { CategoryUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";
import type { Recipe } from "../types.js";

import { RecipeUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { recipeToMarkdown, resolveCategoryRefs } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

// Strict (exported for direct Zod-validation tests). The `categories` field left
// update_recipe for this verb, so categorizing is the one way to change a
// recipe's categories. Commits through commitRecipe (recipe owns category, so the
// resolve is intra-domain).
export const categorizeRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID to categorize"),
    categories: z
      .array(z.string().min(1))
      .min(1)
      .describe(
        "Category references — each is a category UID (from list_categories) or a display name " +
          "(case-insensitive). Unknown names are skipped with a warning.",
      ),
    mode: z
      .enum(["add", "replace", "remove"])
      .default("add")
      .describe(
        'How to apply: "add" (default) unions these with the recipe\'s current categories; ' +
          '"replace" sets the recipe\'s categories to exactly these; "remove" drops these from the recipe.',
      ),
  })
  .strict();

/**
 * Registers `categorize_recipe`, kernel-shaped — recipe owns category, so the ref
 * resolution and name lookup are intra-domain (no deps). Writes through the bound
 * `ctx.self.commitRecipe` chokepoint.
 */
export function categorizeRecipeTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "categorize_recipe" });
  ctx.server.registerTool(
    "categorize_recipe",
    {
      title: "Add, replace, or remove a recipe's categories",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      description:
        "Add, replace, or remove a recipe's categories by UID. Pass category names or UIDs and a mode: " +
        "add (union with current — the default), replace (set exactly these), or remove (drop these). " +
        "Unknown category names are skipped with a warning. To edit other recipe fields, use update_recipe.",
      inputSchema: categorizeRecipeInputSchema,
    },
    async (args) => {
      log.info({ tool: "categorize_recipe", uid: args.uid, mode: args.mode }, "tool invoked");
      return recipeColdStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.self.recipe.store.get(args.uid);
          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}" (it may not exist or was already deleted).`);
          }

          const { uids: refUids, unknown } = resolveCategoryRefs(ctx.self.category.store.getAll(), args.categories);
          const warnings = unknown.map((ref) => `Warning: category "${ref}" not found and was skipped.`);

          // Nothing resolved (every ref was unknown). Short-circuit rather than
          // saving a no-op — and, for `replace`, this is the guard that prevents
          // an all-typos call from silently wiping the recipe's categories.
          if (refUids.length === 0) {
            const prefix = warnings.length > 0 ? warnings.join("\n") + "\n\n" : "";
            return textResult(`${prefix}No known categories matched, so "${existing.name}" was left unchanged.`);
          }

          // Compute the next category set per mode. Sets dedupe while preserving order.
          let nextCategories: Array<CategoryUid>;
          if (args.mode === "replace") {
            nextCategories = [...new Set(refUids)];
          } else if (args.mode === "remove") {
            const drop = new Set<string>(refUids);
            nextCategories = existing.categories.filter((c) => !drop.has(c));
          } else {
            nextCategories = [...new Set<CategoryUid>([...existing.categories, ...refUids])];
          }

          const updated: Recipe = { ...existing, categories: nextCategories };

          let saved: Recipe;
          try {
            saved = await ctx.infra.client.saveRecipe(updated);
            await ctx.self.commitRecipe(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to categorize recipe: ${message}`);
          }

          const categoryNames = ctx.self.category.store.resolveNames(saved.categories);
          const markdown = recipeToMarkdown(saved, categoryNames);
          const prefix = warnings.length > 0 ? warnings.join("\n") + "\n\n" : "";
          return textResult(prefix + markdown);
        },
        (guard) => guard,
      );
    },
  );
}
