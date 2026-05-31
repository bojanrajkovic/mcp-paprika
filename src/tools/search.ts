import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ScoredResult } from "../cache/recipe-store.js";
import { coldStartGuard, recipeMetadataLines, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerSearchTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "search_recipes" });
  server.registerTool(
    "search_recipes",
    {
      description:
        "Search for recipes by name, ingredients, or description. Returns a ranked list of matching recipes.",
      inputSchema: {
        query: z.string().describe("Search query text"),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(20)
          .describe("Maximum number of results to return (default: 20, max: 50)"),
      },
    },
    async (args) => {
      log.info({ tool: "search_recipes", ...args }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const results = ctx.store.search(args.query, { limit: args.limit });
          if (results.length === 0) {
            return textResult(`No recipes found matching "${args.query}".`);
          }
          const lines = results.map((r) => {
            const categoryNames = ctx.categoryStore.resolveNames(r.recipe.categories);
            const lastCooked = ctx.mealStore.lastCookedAt(r.recipe.uid);
            return formatSearchHit(r, categoryNames, lastCooked);
          });
          return textResult(lines.join("\n\n---\n\n"));
        },
        (guard) => guard,
      );
    },
  );
}

function formatSearchHit(result: ScoredResult, categoryNames: Array<string>, lastCookedAt?: string | null): string {
  const lines: Array<string> = [];
  lines.push(`## ${result.recipe.name}`);
  lines.push(`UID: \`${result.recipe.uid}\``);
  if (categoryNames.length > 0) {
    lines.push(`**Categories:** ${categoryNames.join(", ")}`);
  }
  lines.push(...recipeMetadataLines(result.recipe, lastCookedAt));
  return lines.join("\n");
}
