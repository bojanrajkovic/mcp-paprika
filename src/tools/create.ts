import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeUidSchema } from "../paprika/types.js";
import type { CategoryUid, Recipe } from "../paprika/types.js";
import { coldStartGuard, commitRecipe, recipeToMarkdown, resolveCategoryNames, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerCreateTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "create_recipe",
    {
      description: "Create a new recipe in the Paprika account.",
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
        categories: z.array(z.string()).optional().describe("Category display names (case-insensitive)"),
        source: z.string().optional().describe("Source name"),
        sourceUrl: z.string().optional().describe("Source URL"),
        difficulty: z.string().optional().describe("Difficulty level"),
        rating: z.number().int().min(0).max(5).optional().describe("Rating 0–5 (default: 0)"),
        nutritionalInfo: z.string().optional().describe("Nutritional information"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Resolve category names → UIDs (AC2.4, AC2.7)
          const { uids: categories, unknown: unknownCategories } =
            args.categories && args.categories.length > 0
              ? resolveCategoryNames(ctx.store.getAllCategories(), args.categories)
              : { uids: [] as Array<CategoryUid>, unknown: [] as Array<string> };

          const warnings = unknownCategories.map((name) => `Warning: category "${name}" not found and was skipped.`);

          // Build the full Recipe object — all 28 fields required by the type
          // hash: "" — Paprika API returns the real hash in the saveRecipe response
          const uid = RecipeUidSchema.parse(crypto.randomUUID());
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
            created: new Date().toISOString(),
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
          };

          let saved: Recipe;
          try {
            saved = await ctx.client.saveRecipe(newRecipe); // AC2.5
            await commitRecipe(ctx, saved); // AC2.5, AC2.6
          } catch (error) {
            // AC2.8: store/cache not updated — commitRecipe not reached
            return textResult(`Failed to create recipe: ${error instanceof Error ? error.message : String(error)}`);
          }

          const categoryNames = ctx.store.resolveCategories(saved.categories);
          const markdown = recipeToMarkdown(saved, categoryNames);
          const prefix = warnings.length > 0 ? warnings.join("\n") + "\n\n" : "";
          return textResult(prefix + markdown);
        },
        (guard) => guard,
      );
    },
  );
}
