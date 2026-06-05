import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { RecipeUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";

import { recipeToMarkdown } from "../recipe-markdown.js";

/**
 * `paprika://recipe/{uid}` — render a recipe as markdown. Categories are owned by
 * recipe, so names resolve through `ctx.state.category.store`, not a dep. Recipe is
 * one of the three Content-class entities with a resource surface (ADR-0004).
 */
export function recipeResource(ctx: DomainCtx<RecipeState, never>): void {
  const template = new ResourceTemplate("paprika://recipe/{uid}", {
    list: async () => {
      const recipes = ctx.state.recipe.store.getAll();
      return {
        resources: recipes.map((recipe) => ({
          uri: `paprika://recipe/${recipe.uid}`,
          name: recipe.name,
          mimeType: "text/markdown",
        })),
      };
    },
  });

  ctx.server.registerResource(
    "recipes",
    template,
    { description: "Paprika recipes accessible by UID" },
    async (uri, variables) => {
      const uid = variables["uid"] as RecipeUid;
      const recipe = ctx.state.recipe.store.get(uid);
      if (!recipe) {
        throw new Error(`Recipe not found: ${uid}`);
      }
      const categoryNames = ctx.state.category.store.resolveNames(recipe.categories);

      // UID is rendered by recipeToMarkdown (shared with read_recipe), so the
      // resource header carries only the metadata the body doesn't: URI, sync
      // time, photo. (Avoids a duplicate UID line — Codex P3 on #195.)
      const headerLines = [`**URI:** \`paprika://recipe/${uid}\``];

      const lastSynced = ctx.state.recipe.store.lastSyncedAt;
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
