import { z } from "zod";

import type { Category } from "./category/types.js";
import type { CategoryUid } from "./ids.js";
import type { Recipe } from "./types.js";

import { RecipeUidSchema } from "./ids.js";

/**
 * The structured-output row for one recipe (ADR-0019, R1) — the machine-readable
 * counterpart to the list/search text, shared by `list_recipes` and `search_recipes`.
 * The `uid` is what the model's follow-ups (`read_recipe`, `rate_recipe`,
 * `add_recipe_to_grocery_list`, …) consume; the rest are the selection fields the
 * text shows (category names, rating, times, the two state flags). The full recipe
 * body (ingredients/directions/etc.) stays in `read_recipe` — a list row is a summary.
 */
export const recipeRowSchema = z.object({
  uid: RecipeUidSchema,
  name: z.string(),
  categories: z.array(z.string()).describe("Category names this recipe belongs to."),
  rating: z.number().int().describe("0–5; 0 means unrated."),
  prepTime: z.string().nullable(),
  cookTime: z.string().nullable(),
  totalTime: z.string().nullable(),
  isPinned: z.boolean(),
  onGroceryList: z.boolean(),
});

export type RecipeRow = z.infer<typeof recipeRowSchema>;

/** Map a `Recipe` plus its resolved category names into a {@link RecipeRow}. */
export function recipeToRow(recipe: Recipe, categoryNames: Array<string>): RecipeRow {
  return {
    uid: recipe.uid,
    name: recipe.name,
    categories: categoryNames,
    rating: recipe.rating,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    totalTime: recipe.totalTime,
    isPinned: recipe.isPinned,
    onGroceryList: recipe.onGroceryList,
  };
}

export function recipeToMarkdown(recipe: Recipe, categoryNames: Array<string>, lastCookedAt?: string | null): string {
  const lines: Array<string> = [];

  lines.push(`# ${recipe.name}`);

  lines.push("");
  lines.push(`**UID:** \`${recipe.uid}\``);

  if (categoryNames.length > 0) {
    lines.push("");
    lines.push(`**Categories:** ${categoryNames.join(", ")}`);
  }

  lines.push("");
  lines.push(`**Created:** ${recipe.created}`);

  if (lastCookedAt) {
    lines.push(`**Last Cooked:** ${lastCookedAt.slice(0, 10)}`);
  }

  if (recipe.rating > 0) {
    lines.push(`**Rating:** ${recipe.rating.toString()}/5`);
  }

  if (recipe.isPinned) {
    lines.push(`**Pinned:** Yes`);
  }

  if (recipe.onGroceryList) {
    lines.push(`**On Grocery List:** Yes`);
  }

  if (recipe.onFavorites) {
    lines.push(`**On Favorites:** Yes`);
  }

  if (recipe.description) {
    lines.push("");
    lines.push(recipe.description);
  }

  const timeParts: Array<string> = [];
  if (recipe.prepTime) timeParts.push(`Prep: ${recipe.prepTime}`);
  if (recipe.cookTime) timeParts.push(`Cook: ${recipe.cookTime}`);
  if (recipe.totalTime) timeParts.push(`Total: ${recipe.totalTime}`);
  if (timeParts.length > 0) {
    lines.push("");
    lines.push(timeParts.join(" · "));
  }

  if (recipe.servings) {
    lines.push("");
    lines.push(`**Servings:** ${recipe.servings}`);
  }

  if (recipe.difficulty) {
    lines.push("");
    lines.push(`**Difficulty:** ${recipe.difficulty}`);
  }

  lines.push("");
  lines.push("## Ingredients");
  lines.push("");
  lines.push(recipe.ingredients);

  lines.push("");
  lines.push("## Directions");
  lines.push("");
  lines.push(recipe.directions);

  if (recipe.notes) {
    lines.push("");
    lines.push("## Notes");
    lines.push("");
    lines.push(recipe.notes);
  }

  if (recipe.nutritionalInfo) {
    lines.push("");
    lines.push("## Nutritional Info");
    lines.push("");
    lines.push(recipe.nutritionalInfo);
  }

  if (recipe.source) {
    lines.push("");
    if (recipe.sourceUrl) {
      lines.push(`**Source:** [${recipe.source}](${recipe.sourceUrl})`);
    } else {
      lines.push(`**Source:** ${recipe.source}`);
    }
  } else if (recipe.sourceUrl) {
    lines.push("");
    lines.push(`**Source:** ${recipe.sourceUrl}`);
  }

  return lines.join("\n");
}

export function recipeMetadataLines(recipe: Recipe, lastCookedAt?: string | null): Array<string> {
  const lines: Array<string> = [];
  const timeParts: Array<string> = [];
  if (recipe.prepTime) timeParts.push(`Prep: ${recipe.prepTime}`);
  if (recipe.cookTime) timeParts.push(`Cook: ${recipe.cookTime}`);
  if (recipe.totalTime) timeParts.push(`Total: ${recipe.totalTime}`);
  if (timeParts.length > 0) {
    lines.push(timeParts.join(" · "));
  }
  if (recipe.rating > 0) {
    lines.push(`**Rating:** ${recipe.rating.toString()}/5`);
  }
  if (lastCookedAt) {
    lines.push(`**Last Cooked:** ${lastCookedAt.slice(0, 10)}`);
  }
  if (recipe.isPinned) {
    lines.push(`**Pinned:** Yes`);
  }
  if (recipe.onGroceryList) {
    lines.push(`**On Grocery List:** Yes`);
  }
  return lines;
}

/**
 * Resolves category references to CategoryUid values. Each ref is matched
 * UID-first (exact match against a known category's uid), then by display name
 * (case-insensitive). A category UID and a display name are both unconstrained
 * strings — `CategoryUidSchema` carries no format — so they can't be told apart
 * by the schema; the union lives here. Lets callers pass either the UID returned
 * by `list_categories` or a human-readable name.
 *
 * @returns uids — matched UIDs in the same order as input refs
 *          unknown — refs that matched neither a UID nor a name (caller should warn)
 */
export function resolveCategoryRefs(
  all: Array<Category>,
  refs: Array<string>,
): { uids: Array<CategoryUid>; unknown: Array<string> } {
  const byUid = new Set<string>(all.map((c) => c.uid));
  const uids: Array<CategoryUid> = [];
  const unknown: Array<string> = [];
  for (const ref of refs) {
    if (byUid.has(ref)) {
      uids.push(ref as CategoryUid);
      continue;
    }
    const lower = ref.toLowerCase();
    const match = all.find((c) => c.name.toLowerCase() === lower);
    if (match) {
      uids.push(match.uid);
    } else {
      unknown.push(ref);
    }
  }
  return { uids, unknown };
}
