import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Category } from "../paprika/types.js";
import { coldStartGuard, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerCategoryTools(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "list_categories",
    {
      description:
        "List all recipe categories with the number of recipes in each. Categories are sorted alphabetically.",
      inputSchema: {},
    },
    async (_args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const categories = ctx.store.getAllCategories();
          if (categories.length === 0) {
            return textResult("No categories found in your recipe library.");
          }

          const recipes = ctx.store.getAll();

          // Initialize every category with count 0 so categories with no recipes
          // still appear in the output (AC4.3).
          const countMap = new Map<string, number>();
          for (const category of categories) {
            countMap.set(category.uid, 0);
          }

          // Increment count for each non-trashed recipe's categories.
          // getAll() already excludes trashed recipes.
          for (const recipe of recipes) {
            for (const uid of recipe.categories) {
              const current = countMap.get(uid) ?? 0;
              countMap.set(uid, current + 1);
            }
          }

          const sorted = categories.toSorted((a, b) => a.name.localeCompare(b.name));

          return textResult(formatCategoryList(sorted, countMap));
        },
        (guard) => guard,
      );
    },
  );
}

function formatCategoryList(categories: Array<Category>, countMap: Map<string, number>): string {
  const lines = categories.map((c) => {
    const count = countMap.get(c.uid) ?? 0;
    return `- **${c.name}** (${String(count)} ${count === 1 ? "recipe" : "recipes"})`;
  });
  return `## Recipe Categories\n\n${lines.join("\n")}`;
}
