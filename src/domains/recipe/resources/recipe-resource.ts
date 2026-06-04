import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { RecipeUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeSelf } from "../module.js";

import { recipeToMarkdown } from "../recipe-markdown.js";

/**
 * Registers `paprika://recipe/{uid}`, kernel-shaped — reads this module's own
 * recipe and category stores via `ctx.self` (categories are INSIDE recipe now, so
 * names resolve through `ctx.self.category.store`, not a dep). Recipe is one of the
 * three Content-class entities with a resource surface (ADR-0004). Lifted verbatim
 * from `src/resources/recipes.ts`; the `lastCookedAt` enrichment never lived here.
 */
export function recipeResource(ctx: DomainCtx<RecipeSelf, never>): void {
  const template = new ResourceTemplate("paprika://recipe/{uid}", {
    list: async () => {
      const recipes = ctx.self.recipe.store.getAll();
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
      const recipe = ctx.self.recipe.store.get(uid);
      if (!recipe) {
        throw new Error(`Recipe not found: ${uid}`);
      }
      const categoryNames = ctx.self.category.store.resolveNames(recipe.categories);

      // UID is rendered by recipeToMarkdown (shared with read_recipe), so the
      // resource header carries only the metadata the body doesn't: URI, sync
      // time, photo. (Avoids a duplicate UID line — Codex P3 on #195.)
      const headerLines = [`**URI:** \`paprika://recipe/${uid}\``];

      const lastSynced = ctx.self.recipe.store.lastSyncedAt;
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
