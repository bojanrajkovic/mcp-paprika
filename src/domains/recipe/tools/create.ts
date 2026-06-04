import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { CategoryUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";
import type { Recipe } from "../types.js";

import { RecipeUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { formatTimestampWire } from "../../../utils/dates.js";
import { toMessage } from "../../../utils/log.js";
import { recipeToMarkdown, resolveCategoryRefs } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

/**
 * Registers `create_recipe`, kernel-shaped — resolves category refs against this
 * module's own category store, writes through `ctx.self.commitRecipe` (the bound
 * write chokepoint), and reads names via `ctx.self.category.store`.
 */
export function createRecipeTool(ctx: DomainCtx<RecipeSelf, never>): void {
  const log = ctx.infra.log.child({ component: "create_recipe" });
  ctx.server.registerTool(
    "create_recipe",
    {
      title: "Create a new recipe",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      description:
        "Create a new recipe in the Paprika account. If you built this recipe from a web page, " +
        "follow up with `upload_recipe_photo` and the page's main/hero (og:image) image URL to attach its photo.",
      inputSchema: {
        name: z.string().describe("Recipe name"),
        ingredients: z.string().describe("Ingredients list"),
        directions: z.string().describe("Cooking directions"),
        description: z.string().optional().describe("Brief description"),
        notes: z.string().optional().describe("Additional notes"),
        servings: z.string().optional().describe("Number of servings"),
        prepTime: z.string().optional().describe("Prep time (e.g. '15 min')"),
        cookTime: z.string().optional().describe("Cook time (e.g. '30 min')"),
        totalTime: z.string().optional().describe("Total time (e.g. '45 min')"),
        categories: z
          .array(z.string())
          .optional()
          .describe(
            "Categories to assign. Each entry is either a category UID (from `list_categories`) or a display " +
              "name (case-insensitive). Unknown names are skipped with a warning — create them first with " +
              "`create_category` if needed.",
          ),
        source: z.string().optional().describe("Source name"),
        sourceUrl: z.string().optional().describe("Source URL"),
        difficulty: z.string().optional().describe("Difficulty level"),
        rating: z.number().int().min(0).max(5).optional().describe("Rating 0–5 (default: 0)"),
        nutritionalInfo: z.string().optional().describe("Nutritional information"),
      },
    },
    async (args) => {
      log.info({ tool: "create_recipe", name: args.name }, "tool invoked");
      return recipeColdStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          // Resolve category refs (UID or name) → UIDs (AC2.4, AC2.7)
          const { uids: categories, unknown: unknownCategories } =
            args.categories && args.categories.length > 0
              ? resolveCategoryRefs(ctx.self.category.store.getAll(), args.categories)
              : { uids: [] as Array<CategoryUid>, unknown: [] as Array<string> };

          const warnings = unknownCategories.map((ref) => `Warning: category "${ref}" not found and was skipped.`);

          // Build the full Recipe object — all 28 fields required by the type.
          // hash: "" is a placeholder — `client.saveRecipe` stamps the real
          // content hash at the network boundary (stampContentHash, #167) and returns
          // the hashed recipe, so the POST and the local commit are hash-consistent
          // and the next sync won't re-fetch this recipe.
          // Uppercase to match Paprika's native UUID format — the desktop client
          // mints uppercase, and every other tool here already does (the server
          // accepts either case but is case-preserving). See ADR-0007.
          const uid = RecipeUidSchema.parse(crypto.randomUUID().toUpperCase());
          const newRecipe: Recipe = {
            uid,
            hash: "",
            name: args.name,
            categories,
            ingredients: args.ingredients,
            directions: args.directions,
            description: args.description ?? null, // AC2.3: omitted → null
            notes: args.notes ?? null,
            prepTime: args.prepTime ?? null,
            cookTime: args.cookTime ?? null,
            totalTime: args.totalTime ?? null,
            servings: args.servings ?? null,
            difficulty: args.difficulty ?? null,
            rating: args.rating ?? 0, // AC2.3: omitted → 0 (Paprika's default)
            created: formatTimestampWire(new Date()), // yyyy-MM-dd HH:mm:ss — Paprika 500s on ISO-8601 (#159)
            imageUrl: "",
            photo: null,
            photoHash: null,
            photoLarge: null,
            photoUrl: null,
            source: args.source ?? null,
            sourceUrl: args.sourceUrl ?? null,
            onFavorites: false,
            inTrash: false,
            isPinned: false,
            onGroceryList: false,
            scale: null,
            nutritionalInfo: args.nutritionalInfo ?? null,
            deleted: false, // a freshly created recipe is never a hard-delete tombstone (#125)
          };

          let saved: Recipe;
          try {
            saved = await ctx.infra.client.saveRecipe(newRecipe); // AC2.5
            await ctx.self.commitRecipe(saved); // AC2.5, AC2.6
          } catch (error) {
            // AC2.8: store/cache not updated — commitRecipe not reached
            const message = toMessage(error);
            log.error({ err: error, name: args.name }, "saveRecipe failed");
            return textResult(`Failed to create recipe: ${message}`);
          }

          const categoryNames = ctx.self.category.store.resolveNames(saved.categories);
          const markdown = recipeToMarkdown(saved, categoryNames);
          const prefix = warnings.length > 0 ? warnings.join("\n") + "\n\n" : "";
          // The UID is rendered by recipeToMarkdown, so the caller can chain
          // upload_recipe_photo / update_recipe without re-looking-up the new recipe.
          return textResult(prefix + markdown);
        },
        (guard) => guard,
      );
    },
  );
}
