import { z } from "zod";

import type { Category } from "./category/types.js";
import type { CategoryUid } from "./ids.js";
import type { Recipe } from "./types.js";

import { CategoryUidSchema, RecipeUidSchema } from "./ids.js";

/**
 * The `ui://recipe/{uid}/photo` resource URI when a recipe has a photo the proxy can
 * actually serve — an uploaded photo (`photoLarge`, the full-image cover whose bytes
 * live in the photo catalog) or an imported source image (`imageUrl`/`photoUrl`) — else
 * `null`. Surfaced additively on the browse rows and the single-recipe read so a consumer
 * can fetch the cover photo's bytes through the proxy resource; `null` tells a widget to
 * keep its placeholder tile rather than attempt (and 404) a read.
 *
 * The thumbnail-only `photo` field is deliberately NOT counted: the resolver serves the
 * full image (`photoLarge` → catalog) or a source URL, never the bare thumbnail filename,
 * so counting `photo` would advertise a URI that 404s for a recipe that has only a
 * thumbnail and no catalog entry.
 */
export function recipePhotoResourceUri(recipe: Recipe): string | null {
  const hasPhoto = Boolean(recipe.photoLarge || recipe.imageUrl || recipe.photoUrl);
  return hasPhoto ? `ui://recipe/${recipe.uid}/photo` : null;
}

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
  servings: z.string().nullable(),
  isPinned: z.boolean(),
  onGroceryList: z.boolean(),
  created: z.string().describe("Creation timestamp (Paprika wire format), for recency sorting."),
  photoResourceUri: z
    .string()
    .nullable()
    .describe("Resource URI for the recipe's cover photo (ui://recipe/{uid}/photo), or null when it has none."),
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
    servings: recipe.servings,
    isPinned: recipe.isPinned,
    onGroceryList: recipe.onGroceryList,
    created: recipe.created,
    photoResourceUri: recipePhotoResourceUri(recipe),
  };
}

/**
 * The source-identity envelope on the browse tools' structured output. The recipe-browse
 * widget declares on `list_recipes`, `search_recipes`, and `discover_recipes` alike, so a
 * result must say which it came from — the widget adapts only its header copy ("My recipes"
 * / "Results for '…'" / "Recipes for you") and gates the rating/alpha sort to `list` (search
 * and discover carry their own ordering). `query` carries the originating term for the
 * search/discover header without the widget parsing tool arguments.
 */
export const browseContextSchema = z.object({
  source: z.enum(["list", "search", "discover"]),
  query: z.string().optional(),
});

export type BrowseContext = z.infer<typeof browseContextSchema>;

/**
 * `search_recipes`' structured-output payload (ADR-0019, R1): the matched recipe rows (capped at
 * `limit`) plus `total`, the full match count before the cap — so the model can tell its results
 * were truncated. `context` carries the source + query term for the recipe-browse widget's header;
 * the widget respects search ordering (no client re-sort).
 */
export const searchRecipesOutputSchema = z.object({
  context: browseContextSchema,
  items: z.array(recipeRowSchema),
  total: z.number().int().nonnegative(),
});

export type RecipeSearchStructured = z.infer<typeof searchRecipesOutputSchema>;

/**
 * `list_recipes`' structured-output payload (ADR-0019, R1): the page of recipe rows plus the
 * pagination cursor — `total` is the full library size, `offset` the page start. `context`
 * identifies the source for the recipe-browse widget (this is the only browse tool that offers a
 * client-side rating/alpha re-sort).
 */
export const listRecipesOutputSchema = z.object({
  context: browseContextSchema,
  items: z.array(recipeRowSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

export type RecipeListStructured = z.infer<typeof listRecipesOutputSchema>;

/**
 * The structured-output payload for `read_recipe` / `create_recipe` (ADR-0019, R1,
 * B1/#321). Unlike the lean {@link recipeRowSchema} list row, the single-recipe read
 * carries the full body (ingredients/directions/etc.) and `photoUrl`: its demonstrated
 * downstream consumer is the step-anchored cooking widget (#337, "layered on
 * read_recipe") and the recipe-card read-action (#336), both of which render from this
 * payload. `categoryUids` is the raw FK that drives `categorize_recipe`; `categories`
 * is the resolved-name view the text also shows (the raw+resolved split A3 uses for
 * meal-type). The full prose still renders in the text block — this is the machine view.
 */
export const recipeReadOutputSchema = z.object({
  uid: RecipeUidSchema,
  name: z.string(),
  categoryUids: z.array(CategoryUidSchema).describe("Category UIDs this recipe belongs to (drives categorize_recipe)."),
  categories: z.array(z.string()).describe("Resolved category names."),
  rating: z.number().int().describe("0–5; 0 means unrated."),
  prepTime: z.string().nullable(),
  cookTime: z.string().nullable(),
  totalTime: z.string().nullable(),
  servings: z.string().nullable(),
  difficulty: z.string().nullable(),
  ingredients: z.string(),
  directions: z.string(),
  description: z.string().nullable(),
  notes: z.string().nullable(),
  nutritionalInfo: z.string().nullable(),
  source: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  photoUrl: z
    .string()
    .nullable()
    .describe("Display photo URL — the imported source image or an uploaded Paprika photo, or null."),
  photoResourceUri: z
    .string()
    .nullable()
    .describe(
      "Resource URI for the recipe's cover photo (ui://recipe/{uid}/photo) — reads back the bytes even for " +
        "user-uploaded photos that have no public URL — or null when the recipe has no photo.",
    ),
  isPinned: z.boolean(),
  onFavorites: z.boolean(),
  onGroceryList: z.boolean(),
  created: z.string(),
});

export type RecipeReadStructured = z.infer<typeof recipeReadOutputSchema>;

/** Map a `Recipe` plus its resolved category names into a {@link RecipeReadStructured}. */
export function recipeToReadStructured(recipe: Recipe, categoryNames: Array<string>): RecipeReadStructured {
  return {
    uid: recipe.uid,
    name: recipe.name,
    categoryUids: recipe.categories,
    categories: categoryNames,
    rating: recipe.rating,
    prepTime: recipe.prepTime,
    cookTime: recipe.cookTime,
    totalTime: recipe.totalTime,
    servings: recipe.servings,
    difficulty: recipe.difficulty,
    ingredients: recipe.ingredients,
    directions: recipe.directions,
    description: recipe.description,
    notes: recipe.notes,
    nutritionalInfo: recipe.nutritionalInfo,
    source: recipe.source,
    sourceUrl: recipe.sourceUrl,
    // Display photo, coalesced like the recipe resource (recipe-resource.ts): an imported
    // recipe carries image_url with photo_url still null, so a card rendering from photoUrl
    // alone would drop the photo. `|| null` normalizes a trailing "" (a fresh recipe's
    // imageUrl) to null.
    photoUrl: recipe.imageUrl || recipe.photoUrl || null,
    photoResourceUri: recipePhotoResourceUri(recipe),
    isPinned: recipe.isPinned,
    onFavorites: recipe.onFavorites,
    onGroceryList: recipe.onGroceryList,
    created: recipe.created,
  };
}

// The model's split of the prep budget, surfaced on the cooking widget's prep screen as a real,
// schedulable step. `activeMin` is hands-on mise-en-place; `passiveWaitMin` is the unattended wait
// (marinate/soak/chill/rest) that, when long, must be started first. Shared by `cook_recipe`'s
// input (the model's estimate) and output (the validated echo).
export const cookPrepSchema = z.object({
  activeMin: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Your estimate of hands-on prep minutes before first heat — knife work, measuring, making sub-components. " +
        "Active work only; do NOT fold marinating/resting time in here.",
    ),
  passiveWaitMin: z
    .number()
    .int()
    .nonnegative()
    .describe(
      "Unattended wait BEFORE first heat that the cook must start ahead of cooking — marinating, soaking, brining, " +
        "chilling a dough. 0 when there is none. It is surfaced on the prep screen as 'start this first', so do NOT " +
        "include post-cook rests (resting meat, cooling): those happen after cooking and stay as cook steps.",
    ),
});

// `cook_recipe`'s validated echo: the model's parse passed straight through, plus the stored
// recipe's identity (name/servings/totalTime/prepTime/photo) so the model never retypes what the
// store already holds. The cooking widget renders entirely off this structured channel. `prepTime`
// is the recipe's STATED prep (enriched from the store) — shown as a secondary to the model's own
// `prep` estimate, which the stated value routinely under- or over-reports.
export const cookRecipeOutputSchema = z.object({
  recipe_uid: RecipeUidSchema,
  name: z.string(),
  servings: z.string().nullable(),
  totalTime: z.string().nullable(),
  prepTime: z.string().nullable(),
  photoResourceUri: z.string().nullable(),
  ingredients: z.array(z.object({ text: z.string(), group: z.string().nullable() })),
  prep: cookPrepSchema,
  steps: z.array(
    z.object({
      text: z.string(),
      group: z.string().nullable(),
      ingredientRefs: z.array(z.number().int()),
      produces: z.string().nullable(),
      usesIntermediate: z.array(z.string()),
      phase: z.enum(["prep", "cook"]),
    }),
  ),
});

export type CookRecipeStructured = z.infer<typeof cookRecipeOutputSchema>;

export function recipeToMarkdown(recipe: Recipe, categoryNames: Array<string>, lastCookedAt?: string | null): string {
  const lines: Array<string> = [];

  lines.push(`# ${recipe.name}`);

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
