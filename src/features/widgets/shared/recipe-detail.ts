import type { RecipeReadStructured } from "./server-types.js";

/**
 * The recipe-detail slice the inline recipe-detail pane renders, plus the parser that
 * pulls it from a `read_recipe` structured result. Shared by the meal-week-planner and the
 * recipe-browse widget: both tap a recipe and read it inline, consuming the same
 * `read_recipe` payload ({@link RecipeReadStructured}). The slice is a `Pick` of the server's
 * own output type (B1), so a rename of one of these fields breaks the consuming widget at
 * compile time.
 */
export type RecipeDetailData = Pick<
  RecipeReadStructured,
  "name" | "servings" | "totalTime" | "ingredients" | "directions" | "photoResourceUri"
>;

const strOrNull = (v: string | null): string | null => (v !== null && v !== "" ? v : null);

/**
 * Recognise a `read_recipe` structured result and extract the detail slice, or `null`
 * when the shape is not a recipe — so a widget's `receive()` can discriminate it from
 * the meal-week payload (which carries `weekStart`, never `ingredients`/`directions`)
 * and from a toast-only action result. The discriminator is `uid` plus the
 * `ingredients` + `directions` cluster a recipe always carries; past the gate the payload
 * is trusted as the server's shape and the empty-string servings/time/photo sentinels are
 * normalised to null for the display pane.
 */
export function parseRecipeDetail(data: Record<string, unknown> | undefined): RecipeDetailData | null {
  if (
    !data ||
    typeof data["uid"] !== "string" ||
    typeof data["name"] !== "string" ||
    typeof data["ingredients"] !== "string" ||
    typeof data["directions"] !== "string"
  ) {
    return null;
  }
  const r = data as unknown as RecipeReadStructured;
  return {
    name: r.name,
    servings: strOrNull(r.servings),
    totalTime: strOrNull(r.totalTime),
    ingredients: r.ingredients,
    directions: r.directions,
    photoResourceUri: strOrNull(r.photoResourceUri),
  };
}
