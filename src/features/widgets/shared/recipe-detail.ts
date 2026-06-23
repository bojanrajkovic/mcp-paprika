/**
 * The recipe-detail slice the inline recipe-detail pane renders, plus the parser that
 * pulls it from a `read_recipe` structured result. Shared by the meal-week-planner and the
 * recipe-browse widget: both tap a recipe and read it inline, consuming the same
 * `read_recipe` payload (`recipeReadOutputSchema`). Every field is coerced defensively —
 * the host notification params are untrusted (the SDK does not validate them).
 */
export interface RecipeDetailData {
  readonly name: string;
  readonly servings: string | null;
  readonly totalTime: string | null;
  readonly ingredients: string; // newline-delimited, as read_recipe emits
  readonly directions: string; // newline-delimited
  readonly photoResourceUri: string | null; // ui://recipe/{uid}/photo, or null when no photo
}

const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

/**
 * Recognise a `read_recipe` structured result and extract the detail slice, or `null`
 * when the shape is not a recipe — so a widget's `receive()` can discriminate it from
 * the meal-week payload (which carries `weekStart`, never `ingredients`/`directions`)
 * and from a toast-only action result. The discriminator is `uid` plus the
 * `ingredients` + `directions` cluster a recipe always carries.
 */
export function parseRecipeDetail(data: Record<string, unknown> | undefined): RecipeDetailData | null {
  if (!data) return null;
  if (
    typeof data["uid"] !== "string" ||
    typeof data["name"] !== "string" ||
    typeof data["ingredients"] !== "string" ||
    typeof data["directions"] !== "string"
  ) {
    return null;
  }
  return {
    name: data["name"],
    servings: strOrNull(data["servings"]),
    totalTime: strOrNull(data["totalTime"]),
    ingredients: data["ingredients"],
    directions: data["directions"],
    photoResourceUri: strOrNull(data["photoResourceUri"]),
  };
}
