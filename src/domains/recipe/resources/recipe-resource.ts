import type { RecipeUid } from "../ids.js";
import type { RecipeState } from "../module.js";

import { defineResource } from "../../../kernel/resource.js";
import { resourceNotFound } from "../../../shared/resources.js";
import { recipePhotoResourceUri, recipeToMarkdown } from "../recipe-markdown.js";

/**
 * `paprika://recipe/{uid}` — render a recipe as markdown. Categories are owned by
 * recipe, so names resolve through `ctx.state.category.store`, not a dep. Recipe is
 * one of the three Content-class entities with a resource surface.
 */
export const recipeResource = defineResource<RecipeState, never>(
  {
    primary: {
      name: "recipes",
      uriTemplate: "paprika://recipe/{uid}",
      description: "Paprika recipes accessible by UID",
    },
  },
  (ctx) => ({
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
    read: async (uri, variables) => {
      const uid = variables["uid"] as RecipeUid;
      const recipe = ctx.state.recipe.store.get(uid);
      if (!recipe) {
        resourceNotFound(`Recipe not found: ${uid}`);
      }
      const categoryNames = ctx.state.category.store.resolveNames(recipe.categories);

      // The resource header carries the entity UID — the stable identifier a
      // client keys follow-up calls on — alongside the URI, sync time, and photo,
      // so the resource is self-identifying regardless of how the body renders.
      // (The grocery-list and menu resources carry the same header UID.)
      const headerLines = [`**UID:** \`${uid}\``, `**URI:** \`paprika://recipe/${uid}\``];

      const lastSynced = ctx.state.recipe.store.lastSyncedAt;
      if (lastSynced) {
        headerLines.push(`**Last synced:** ${lastSynced.toISOString()}`);
      }

      const photoUrl = recipe.imageUrl || recipe.photoUrl;
      if (photoUrl) {
        headerLines.push(`**Photo:** ${photoUrl}`);
      }

      // The photo proxy resource reads back the bytes even for an uploaded photo that
      // has no public URL — surfaced so a client can fetch it without the URL.
      const photoResourceUri = recipePhotoResourceUri(recipe);
      if (photoResourceUri) {
        headerLines.push(`**Photo resource:** \`${photoResourceUri}\``);
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
  }),
);
