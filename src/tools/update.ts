import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Recipe } from "../recipe/types.js";
import type { ServerContext } from "../types/server-context.js";

import { RecipeUidSchema } from "../ids.js";
import { toMessage } from "../utils/log.js";
import { coldStartGuard, commitRecipe, recipeToMarkdown, resolveCategoryRefs, textResult } from "./helpers.js";

export function registerUpdateTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "update_recipe" });
  server.registerTool(
    "update_recipe",
    {
      description:
        "Update an existing recipe by UID. Only provided fields are changed; " +
        "omitted fields retain their existing values. If categories is provided, " +
        "it replaces the existing category list entirely; omitting categories " +
        "leaves the existing list unchanged. " +
        "Pass inTrash: true to move to trash (soft-delete, reversible) or inTrash: false to restore. " +
        "Use trash_recipe for a dedicated trash workflow.",
      inputSchema: {
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
        categories: z
          .array(z.string())
          .optional()
          .describe(
            "Categories to assign — replaces the existing list when provided. Each entry is either a category " +
              "UID (from `list_categories`) or a display name (case-insensitive). Unknown names are skipped " +
              "with a warning.",
          ),
        source: z.string().optional().describe("New source name"),
        sourceUrl: z.string().optional().describe("New source URL"),
        difficulty: z.string().optional().describe("New difficulty level"),
        rating: z.number().int().min(0).max(5).optional().describe("New rating 0–5"),
        inTrash: z.boolean().optional().describe("true = move to trash, false = restore from trash"),
        nutritionalInfo: z.string().optional().describe("New nutritional information"),
      },
    },
    async (args) => {
      log.info({ tool: "update_recipe", uid: args.uid }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.store.get(args.uid);

          if (!existing) {
            return textResult(`No recipe found with UID "${args.uid}".`);
          }

          // Resolve category refs (UID or name) if provided — replaces list entirely (AC3.2)
          // Check !== undefined so empty array [] correctly removes all categories (AC3.3)
          const { uids: resolvedCategories, unknown: unknownCategories } =
            args.categories !== undefined
              ? resolveCategoryRefs(ctx.categoryStore.getAll(), args.categories)
              : { uids: existing.categories, unknown: [] as Array<string> };

          const warnings = unknownCategories.map((ref) => `Warning: category "${ref}" not found and was skipped.`);

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
            ...(args.inTrash !== undefined && { inTrash: args.inTrash }),
            ...(args.nutritionalInfo !== undefined && { nutritionalInfo: args.nutritionalInfo }),
            categories: resolvedCategories, // always set — either resolved or existing
          };

          let saved: Recipe;
          try {
            saved = await ctx.client.saveRecipe(updated); // AC3.4
            await commitRecipe(ctx, saved); // AC3.4
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "saveRecipe failed");
            return textResult(`Failed to update recipe: ${message}`);
          }

          const categoryNames = ctx.categoryStore.resolveNames(saved.categories);
          const markdown = recipeToMarkdown(saved, categoryNames);
          const prefix = warnings.length > 0 ? warnings.join("\n") + "\n\n" : "";
          return textResult(prefix + markdown);
        },
        (guard) => guard,
      );
    },
  );
}
