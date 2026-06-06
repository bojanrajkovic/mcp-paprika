import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../ids.js";
import { recipeToMarkdown } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

export const pinRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID"),
  })
  .strict();

export const unpinRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID"),
  })
  .strict();

/** `pin_recipe` — pin a recipe so it floats to the top of the recipe list. */
export const pinRecipeTool = defineTool(
  {
    name: "pin_recipe",
    title: "Pin a recipe",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Pin a recipe by UID so it floats to the top of the recipe list.",
    inputSchema: pinRecipeInputSchema,
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "pin_recipe" });
    return async (args) => {
      const existing = ctx.state.recipe.store.get(args.uid);

      if (!existing) {
        return textResult(`No recipe found with UID "${args.uid}" (it may not exist or was already deleted).`);
      }

      const updated = { ...existing, isPinned: true };

      const saved = (await ctx.infra.client.saveRecipe(updated)).match(
        (v) => v,
        (e) => {
          log.error({ err: e, uid: args.uid }, "saveRecipe failed");
          return textResult(`Failed to pin recipe: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;
      const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), { selfHealing: false });
      if (commitErr) return commitErr;

      const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
      return textResult(recipeToMarkdown(saved, categoryNames));
    };
  },
);

/** `unpin_recipe` — unpin a recipe. */
export const unpinRecipeTool = defineTool(
  {
    name: "unpin_recipe",
    title: "Unpin a recipe",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description: "Unpin a recipe by UID (removes it from the pinned set at the top of the recipe list).",
    inputSchema: unpinRecipeInputSchema,
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "unpin_recipe" });
    return async (args) => {
      const existing = ctx.state.recipe.store.get(args.uid);

      if (!existing) {
        return textResult(`No recipe found with UID "${args.uid}" (it may not exist or was already deleted).`);
      }

      const updated = { ...existing, isPinned: false };

      const saved = (await ctx.infra.client.saveRecipe(updated)).match(
        (v) => v,
        (e) => {
          log.error({ err: e, uid: args.uid }, "saveRecipe failed");
          return textResult(`Failed to unpin recipe: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;
      const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), { selfHealing: false });
      if (commitErr) return commitErr;

      const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
      return textResult(recipeToMarkdown(saved, categoryNames));
    };
  },
);

/** Both pin-state registrars, in registration order. */
export const pinRecipeTools = [pinRecipeTool, unpinRecipeTool];
