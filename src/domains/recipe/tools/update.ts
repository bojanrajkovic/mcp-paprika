import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState, RecipeWrites } from "../module.js";
import type { Recipe } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, errorResult, toolResult } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../ids.js";
import { recipeReadOutputSchema, recipeToMarkdown, recipeToReadStructured } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

// Strict schema (exported for direct Zod-validation tests). `.strict()` is
// load-bearing: rating, categories, favorite status, and trash state were
// promoted to their own intent verbs (rate_recipe, categorize_recipe,
// favorite_recipe/unfavorite_recipe, trash_recipe/restore_recipe), so passing
// one of those keys here must be a loud rejection — not a silently dropped key
// that lets the model think it set the field. update_recipe edits content only.
export const updateRecipeInputSchema = z
  .object({
    uid: RecipeUidSchema.describe("Recipe UID to update"),
    name: z.string().optional().describe("New recipe name"),
    ingredients: z.string().optional().describe("New ingredients list"),
    directions: z.string().optional().describe("New cooking directions"),
    description: z.string().optional().describe("New description"),
    notes: z.string().optional().describe("New notes"),
    servings: z.string().optional().describe("New servings"),
    prepTime: z.string().optional().describe("New prep time"),
    cookTime: z.string().optional().describe("New cook time"),
    totalTime: z.string().optional().describe("New total time"),
    source: z.string().optional().describe("New source name"),
    sourceUrl: z.string().optional().describe("New source URL"),
    difficulty: z.string().optional().describe("New difficulty level"),
    nutritionalInfo: z.string().optional().describe("New nutritional information"),
  })
  .strict();

/**
 * `update_recipe` — content-only edit of a recipe's free-form fields.
 */
export const updateRecipeTool = defineTool(
  {
    name: "update_recipe",
    title: "Edit a recipe's details",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Update a recipe's content fields by UID (name, ingredients, directions, description, notes, " +
      "servings, prep/cook/total time, source, difficulty, nutritional info). Only provided fields " +
      "change; omitted fields keep their values. This tool does NOT edit rating, categories, favorite " +
      "status, or trash state — use rate_recipe, categorize_recipe, favorite_recipe / unfavorite_recipe, " +
      "and trash_recipe / restore_recipe for those.",
    inputSchema: updateRecipeInputSchema,
    outputSchema: recipeReadOutputSchema,
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never, RecipeWrites>) => {
    const log = ctx.infra.log.child({ component: "update_recipe" });
    return async (args) => {
      const existing = ctx.state.recipe.store.get(args.uid);

      if (!existing) {
        return errorResult(
          `No recipe found with UID "${args.uid}" (it may not exist or was already deleted). Use \`search_recipes\` to find it.`,
        );
      }

      // Partial merge: conditional spread omits keys when value is undefined.
      // Promoted fields (rating/categories/onFavorites/inTrash) are intentionally
      // absent here — they leave the open-ended editor for their intent verbs.
      const updated: Recipe = {
        ...existing,
        ...(args.name !== undefined && { name: args.name }),
        ...(args.ingredients !== undefined && { ingredients: args.ingredients }),
        ...(args.directions !== undefined && { directions: args.directions }),
        ...(args.description !== undefined && { description: args.description }),
        ...(args.notes !== undefined && { notes: args.notes }),
        ...(args.servings !== undefined && { servings: args.servings }),
        ...(args.prepTime !== undefined && { prepTime: args.prepTime }),
        ...(args.cookTime !== undefined && { cookTime: args.cookTime }),
        ...(args.totalTime !== undefined && { totalTime: args.totalTime }),
        ...(args.source !== undefined && { source: args.source }),
        ...(args.sourceUrl !== undefined && { sourceUrl: args.sourceUrl }),
        ...(args.difficulty !== undefined && { difficulty: args.difficulty }),
        ...(args.nutritionalInfo !== undefined && { nutritionalInfo: args.nutritionalInfo }),
      };

      const saved = (await ctx.infra.client.saveRecipe(updated)).match(
        (v) => v,
        (e) => {
          log.error({ err: e, uid: args.uid }, "saveRecipe failed");
          return errorResult(`Failed to update recipe: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;
      const categoryNames = ctx.state.category.store.resolveNames(saved.categories);
      const structured = recipeToReadStructured(saved, categoryNames);
      const commitErr = commitFailure("recipe", await ctx.writes.commitRecipe(saved), {
        structuredContent: structured,
        selfHealing: false,
      });
      if (commitErr) return commitErr;

      return toolResult(recipeToMarkdown(saved, categoryNames), structured);
    };
  },
);
