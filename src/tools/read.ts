import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RecipeUidSchema } from "../paprika/types.js";
import { coldStartGuard, recipeToMarkdown, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerReadTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "read_recipe" });
  server.registerTool(
    "read_recipe",
    {
      description:
        "Read a recipe by UID or title. Title lookup is fuzzy (exact → starts-with → contains) " +
        "and returns a disambiguation list when multiple recipes match the same tier. " +
        'Pass exactly one shape: {"uid": "..."} or {"title": "..."}.',
      inputSchema: {
        lookup: z
          .union([
            z.object({ uid: z.string() }).describe('Exact recipe UID, e.g. {"uid": "..."}.'),
            z.object({ title: z.string() }).describe('Recipe title fuzzy match, e.g. {"title": "Chocolate Cake"}.'),
          ])
          .describe('Pick exactly one shape: {"uid": "..."} or {"title": "..."}.'),
      },
    },
    async (args) => {
      log.info({ tool: "read_recipe", ...args.lookup }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if ("uid" in args.lookup) {
            const recipe = ctx.store.get(RecipeUidSchema.parse(args.lookup.uid));
            if (!recipe) {
              return textResult(`No recipe found with UID "${args.lookup.uid}".`);
            }
            const categoryNames = ctx.store.resolveCategories(recipe.categories);
            const lastCooked = ctx.mealStore.lastCookedAt(recipe.uid);
            return textResult(recipeToMarkdown(recipe, categoryNames, lastCooked));
          }

          const matches = ctx.store.findByName(args.lookup.title);

          if (matches.length === 0) {
            return textResult(`No recipes found matching "${args.lookup.title}".`);
          }

          if (matches.length === 1) {
            const recipe = matches[0]!;
            const categoryNames = ctx.store.resolveCategories(recipe.categories);
            const lastCooked = ctx.mealStore.lastCookedAt(recipe.uid);
            return textResult(recipeToMarkdown(recipe, categoryNames, lastCooked));
          }

          const list = matches.map((r) => `- ${r.name} (UID: ${r.uid})`).join("\n");
          return textResult(
            `Multiple recipes match "${args.lookup.title}":\n${list}\n\nPlease re-invoke with a specific uid.`,
          );
        },
        (guard) => guard,
      );
    },
  );
}
