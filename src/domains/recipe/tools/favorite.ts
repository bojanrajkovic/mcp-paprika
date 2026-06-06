import { makeRecipeFlagTool, recipeFlagInputSchema } from "./flag-tool.js";

export const favoriteRecipeInputSchema = recipeFlagInputSchema();
export const unfavoriteRecipeInputSchema = recipeFlagInputSchema();

/** `favorite_recipe` — mark a recipe as a favorite. */
export const favoriteRecipeTool = makeRecipeFlagTool({
  name: "favorite_recipe",
  title: "Mark a recipe as a favorite",
  description: "Mark a recipe as a favorite by UID (adds it to the Favorites list).",
  inputSchema: favoriteRecipeInputSchema,
  flag: "onFavorites",
  value: true,
  failVerb: "favorite",
});

/** `unfavorite_recipe` — remove a recipe from favorites. */
export const unfavoriteRecipeTool = makeRecipeFlagTool({
  name: "unfavorite_recipe",
  title: "Remove a recipe from favorites",
  description: "Remove a recipe from the Favorites list by UID.",
  inputSchema: unfavoriteRecipeInputSchema,
  flag: "onFavorites",
  value: false,
  failVerb: "unfavorite",
});

/** Both favorite-state registrars, in registration order. */
export const favoriteRecipeTools = [favoriteRecipeTool, unfavoriteRecipeTool];
