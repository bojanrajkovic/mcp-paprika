import { makeRecipeFlagTool, recipeFlagInputSchema } from "./flag-tool.js";

// Aliases for the shared flag schema — the per-verb names the tests import.
export const pinRecipeInputSchema = recipeFlagInputSchema;
export const unpinRecipeInputSchema = recipeFlagInputSchema;

/** `pin_recipe` — pin a recipe so it floats to the top of the recipe list. */
export const pinRecipeTool = makeRecipeFlagTool({
  name: "pin_recipe",
  title: "Pin a recipe",
  description: "Pin a recipe by UID so it floats to the top of the recipe list.",
  flag: "isPinned",
  value: true,
  failVerb: "pin",
});

/** `unpin_recipe` — unpin a recipe. */
export const unpinRecipeTool = makeRecipeFlagTool({
  name: "unpin_recipe",
  title: "Unpin a recipe",
  description: "Unpin a recipe by UID (removes it from the pinned set at the top of the recipe list).",
  flag: "isPinned",
  value: false,
  failVerb: "unpin",
});

/** Both pin-state registrars, in registration order. */
export const pinRecipeTools = [pinRecipeTool, unpinRecipeTool];
