import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { coldStartGuard, recipeMetadataLines, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";
import type { VectorStore, SemanticResult } from "../features/vector-store.js";
import type { RecipeUid } from "../ids.js";
import type { Recipe } from "../recipe/types.js";

export function registerDiscoverTool(server: McpServer, ctx: ServerContext, vectorStore: VectorStore): void {
  const log = ctx.log.child({ component: "discover_recipes" });
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
        minScore: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe(
            "Optional minimum similarity (cosine, 0-1). Results below it are dropped before the top-K cut, so a query with few genuine matches returns only those instead of padding with weak ones. Omit for no filtering. Use a modest value (e.g. ~0.3) to gate on relevance.",
          ),
      },
    },
    async (args) => {
      log.info({ tool: "discover_recipes", ...args }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const results = await vectorStore.search(args.query, args.topK, args.minScore);
          if (results.length === 0) {
            return textResult("No recipes found matching that description.");
          }

          // Enrich results and filter out recipes that are gone or trashed.
          // `store.get` returns trashed recipes (unlike `getAll`), and a stale
          // vector can outlive a soft-delete, so guard on `inTrash` here as
          // defense-in-depth even though `commitRecipe` removes trashed recipes
          // from the index.
          const enriched: Array<{ result: SemanticResult; recipe: Recipe }> = [];
          for (const result of results) {
            const recipe = ctx.store.get(result.uid as RecipeUid);
            if (recipe && !recipe.inTrash) {
              enriched.push({ result, recipe });
            }
          }

          if (enriched.length === 0) {
            return textResult("No recipes found matching that description.");
          }

          // Format results with re-numbered indices
          const lines = enriched.map((entry, index) => {
            const categoryNames = ctx.categoryStore.resolveNames(entry.recipe.categories);
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
  lines.push(`   UID: \`${recipe.uid}\``);
  if (categoryNames.length > 0) {
    lines.push(`   **Categories:** ${categoryNames.join(", ")}`);
  }
  for (const line of recipeMetadataLines(recipe)) {
    lines.push(`   ${line}`);
  }
  return lines.join("\n");
}
