import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { coldStartGuard, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";
import type { VectorStore, SemanticResult } from "../features/vector-store.js";
import type { Recipe, RecipeUid } from "../paprika/types.js";

export function registerDiscoverTool(server: McpServer, ctx: ServerContext, vectorStore: VectorStore): void {
  server.registerTool(
    "discover_recipes",
    {
      description:
        "Discover recipes using semantic search. Finds recipes matching a natural language description of what you're looking for.",
      inputSchema: {
        query: z.string().describe("Natural language description of what you're looking for"),
        topK: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .default(5)
          .describe("Maximum number of results to return (default: 5, max: 20)"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const results = await vectorStore.search(args.query, args.topK);
          if (results.length === 0) {
            return textResult("No recipes found matching that description.");
          }

          // Enrich results and filter out deleted recipes
          const enriched: Array<{ result: SemanticResult; recipe: Recipe }> = [];
          for (const result of results) {
            const recipe = ctx.store.get(result.uid as RecipeUid);
            if (recipe) {
              enriched.push({ result, recipe });
            }
          }

          if (enriched.length === 0) {
            return textResult("No recipes found matching that description.");
          }

          // Format results with re-numbered indices
          const lines = enriched.map((entry, index) => {
            const categoryNames = ctx.store.resolveCategories(entry.recipe.categories);
            return formatDiscoverHit(index + 1, entry.recipe, entry.result.score, categoryNames);
          });

          return textResult(lines.join("\n\n"));
        },
        (guard) => guard,
      );
    },
  );
}

function formatDiscoverHit(index: number, recipe: Recipe, score: number, categoryNames: Array<string>): string {
  const percentage = Math.round(score * 100);
  const lines: Array<string> = [];
  lines.push(`${String(index)}. **${recipe.name}** — ${String(percentage)}% match`);
  if (categoryNames.length > 0) {
    lines.push(`   **Categories:** ${categoryNames.join(", ")}`);
  }
  const timeParts: Array<string> = [];
  if (recipe.prepTime) timeParts.push(`Prep: ${recipe.prepTime}`);
  if (recipe.cookTime) timeParts.push(`Cook: ${recipe.cookTime}`);
  if (timeParts.length > 0) {
    lines.push(`   ${timeParts.join(" · ")}`);
  }
  lines.push(`   UID: \`${recipe.uid}\``);
  return lines.join("\n");
}
