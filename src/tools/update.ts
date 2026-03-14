import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeUidSchema } from "../paprika/types.js";
import type { Recipe } from "../paprika/types.js";
import { coldStartGuard, commitRecipe, recipeToMarkdown, resolveCategoryNames, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerUpdateTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "update_recipe",
    {
      description:
        "Update an existing recipe by UID. Only provided fields are changed; " +
        "omitted fields retain their existing values. If categories is provided, " +
        "it replaces the existing category list entirely; omitting categories " +
        "leaves the existing list unchanged.",
      inputSchema: {
        uid: z.string().describe("Recipe UID to update"),
        name: z.string().optional().describe("New recipe name"),
        ingredients: z.string().optional().describe("New ingredients list"),
        directions: z.string().optional().describe("New cooking directions"),
        description: z.string().optional().describe("New description"),
        notes: z.string().optional().describe("New notes"),
        servings: z.string().optional().describe("New servings"),
        prepTime: z.string().optional().describe("New prep time"),
        cookTime: z.string().optional().describe("New cook time"),
        totalTime: z.string().optional().describe("New total time"),
        categories: z
          .array(z.string())
          .optional()
          .describe("Category display names — replaces existing list when provided"),
        source: z.string().optional().describe("New source name"),
        sourceUrl: z.string().optional().describe("New source URL"),
        difficulty: z.string().optional().describe("New difficulty level"),
        rating: z.number().int().min(0).max(5).optional().describe("New rating 0–5"),
        nutritionalInfo: z.string().optional().describe("New nutritional information"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = RecipeUidSchema.parse(args.uid);
          const existing = ctx.store.get(uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          // Resolve categories if provided — replaces list entirely (AC3.2)
          // Check !== undefined so empty array [] correctly removes all categories (AC3.3)
          const { uids: resolvedCategories, unknown: unknownCategories } =
            args.categories !== undefined
              ? resolveCategoryNames(ctx.store.getAllCategories(), args.categories)
              : { uids: existing.categories, unknown: [] as Array<string> };

          const warnings = unknownCategories.map((name) => `Warning: category "${name}" not found and was skipped.`);

          // Partial merge: conditional spread omits keys when value is undefined (AC3.1)
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
            ...(args.rating !== undefined && { rating: args.rating }),
            ...(args.nutritionalInfo !== undefined && { nutritionalInfo: args.nutritionalInfo }),
            categories: resolvedCategories, // always set — either resolved or existing
          };

          let saved: Recipe;
          try {
            saved = await ctx.client.saveRecipe(updated); // AC3.4
            await commitRecipe(ctx, saved); // AC3.4
          } catch (error) {
            return textResult(`Failed to update recipe: ${error instanceof Error ? error.message : String(error)}`);
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
