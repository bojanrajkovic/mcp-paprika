import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RecipeUid } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import { recipeToMarkdown } from "../tools/helpers.js";

export function registerRecipeResources(server: McpServer, ctx: ServerContext): void {
  const template = new ResourceTemplate("paprika://recipe/{uid}", {
    list: async () => {
      const recipes = ctx.store.getAll();
      return {
        resources: recipes.map((recipe) => ({
          uri: `paprika://recipe/${recipe.uid}`,
          name: recipe.name,
          mimeType: "text/markdown",
        })),
      };
    },
  });

  server.registerResource(
    "recipes",
    template,
    { description: "Paprika recipes accessible by UID" },
    async (uri, variables) => {
      const uid = variables["uid"] as RecipeUid;
      const recipe = ctx.store.get(uid);
      if (!recipe) {
        throw new Error(`Recipe not found: ${uid}`);
      }
      const categoryNames = ctx.store.resolveCategories(recipe.categories);
      const content = `**UID:** \`${uid}\`\n\n${recipeToMarkdown(recipe, categoryNames)}`;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: content,
          },
        ],
      };
    },
  );
}
