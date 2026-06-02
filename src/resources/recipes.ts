import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RecipeUid } from "../ids.js";
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
      const categoryNames = ctx.categoryStore.resolveNames(recipe.categories);

      // UID is rendered by recipeToMarkdown (shared with read_recipe), so the
      // resource header carries only the metadata the body doesn't: URI, sync
      // time, photo. (Avoids a duplicate UID line — Codex P3 on #195.)
      const headerLines = [`**URI:** \`paprika://recipe/${uid}\``];

      const lastSynced = ctx.store.lastSyncedAt;
      if (lastSynced) {
        headerLines.push(`**Last synced:** ${lastSynced.toISOString()}`);
      }

      const photoUrl = recipe.imageUrl || recipe.photoUrl;
      if (photoUrl) {
        headerLines.push(`**Photo:** ${photoUrl}`);
      }

      const content = `${headerLines.join("\n")}\n\n${recipeToMarkdown(recipe, categoryNames)}`;
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
