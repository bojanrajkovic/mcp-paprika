import type { Meal } from "./types.js";

/**
 * Renders a single meal as a markdown card suitable for inclusion in tool
 * responses. Callers are responsible for resolving `typeName` and `recipeName`
 * from the contexts they hold; a `null` typeName (a dangling `typeUid` whose
 * type was deleted) omits the Type line entirely.
 */
export function mealToMarkdown(meal: Readonly<Meal>, typeName: string | null, recipeName: string | null): string {
  const lines: Array<string> = [];
  lines.push(`# ${meal.name}`);
  lines.push("");
  lines.push(`**UID:** \`${meal.uid}\``);
  lines.push(`**Date:** ${meal.date}`);
  if (typeName !== null) {
    lines.push(`**Type:** ${typeName}`);
  }
  if (meal.recipeUid !== null && recipeName !== null) {
    lines.push(`**Recipe:** ${recipeName} (\`${meal.recipeUid}\`)`);
  } else if (meal.recipeUid === null) {
    lines.push(`**Recipe:** _(freeform)_`);
  }
  if (meal.scale !== null && meal.scale !== "") {
    lines.push(`**Scale:** ${meal.scale}`);
  }
  return lines.join("\n");
}
