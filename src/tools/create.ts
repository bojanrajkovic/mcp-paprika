import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeUidSchema } from "../paprika/types.js";
import type { CategoryUid, Recipe } from "../paprika/types.js";
import { formatTimestampWire } from "../utils/dates.js";
import { coldStartGuard, commitRecipe, recipeToMarkdown, resolveCategoryRefs, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerCreateTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "create_recipe" });
  server.registerTool(
    "create_recipe",
    {
      description:
        "Create a new recipe in the Paprika account. If you built this recipe from a web page, " +
        "follow up with `upload_photo` and the page's main/hero (og:image) image URL to attach its photo.",
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
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Resolve category refs (UID or name) → UIDs (AC2.4, AC2.7)
          const { uids: categories, unknown: unknownCategories } =
            args.categories && args.categories.length > 0
              ? resolveCategoryRefs(ctx.categoryStore.getAll(), args.categories)
              : { uids: [] as Array<CategoryUid>, unknown: [] as Array<string> };

          const warnings = unknownCategories.map((ref) => `Warning: category "${ref}" not found and was skipped.`);

          // Build the full Recipe object — all 28 fields required by the type.
          // hash: "" — Paprika stores the client-supplied hash verbatim (it does
          // not derive one), and the save response is just `{result: true}`, so we
          // have nothing better to send on create. The next sync reconciles it.
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
            saved = await ctx.client.saveRecipe(newRecipe); // AC2.5
            await commitRecipe(ctx, saved); // AC2.5, AC2.6
          } catch (error) {
            // AC2.8: store/cache not updated — commitRecipe not reached
            const message = toMessage(error);
            log.error({ err: error, name: args.name }, "saveRecipe failed");
            return textResult(`Failed to create recipe: ${message}`);
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
