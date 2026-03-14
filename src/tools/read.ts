import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeUidSchema } from "../paprika/types.js";
import { coldStartGuard, recipeToMarkdown, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerReadTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "read_recipe",
    {
      description:
        "Read a recipe by UID or title. When both are provided, UID takes precedence. " +
        "Title lookup is fuzzy (exact → starts-with → contains). Returns a disambiguation " +
        "list when multiple recipes match the same tier.",
      inputSchema: {
        uid: z.string().optional().describe("Exact recipe UID"),
        title: z.string().optional().describe("Recipe title (fuzzy match)"),
      },
    },
    async (args) => {
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (!args.uid && !args.title) {
            return textResult("Please provide either a uid or a title.");
          }

          // UID lookup takes precedence when both are provided (AC1.9)
          if (args.uid) {
            const recipe = ctx.store.get(RecipeUidSchema.parse(args.uid));
            if (!recipe) {
              return textResult(`No recipe found with UID "${args.uid}".`);
            }
            const categoryNames = ctx.store.resolveCategories(recipe.categories);
            return textResult(recipeToMarkdown(recipe, categoryNames));
          }

          // Title fuzzy search — args.title is defined here
          const matches = ctx.store.findByName(args.title!);

          if (matches.length === 0) {
            return textResult(`No recipes found matching "${args.title}".`);
          }

          if (matches.length === 1) {
            const recipe = matches[0]!; // safe: length === 1
            const categoryNames = ctx.store.resolveCategories(recipe.categories);
            return textResult(recipeToMarkdown(recipe, categoryNames));
          }

          // Disambiguation list (AC1.4)
          const list = matches.map((r) => `- ${r.name} (UID: ${r.uid})`).join("\n");
          return textResult(
            `Multiple recipes match "${args.title}":\n${list}\n\nPlease re-invoke with a specific uid.`,
          );
        },
        (guard) => guard,
      );
    },
  );
}
