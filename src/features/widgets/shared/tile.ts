/**
 * A deterministic placeholder tile colour for an entity that carries no photo — a food-range OKLCH
 * hue (38–129, deliberately clear of the brand red at ~22–35) hashed from the name's char codes,
 * with lightness and chroma fixed per theme. Stable per name and intentional-looking, not random.
 * Shared by the recipe-browse row (a recipe with no cover photo) and the menu header (a menu never
 * has a photo), so the two surfaces colour the same name the same way.
 */
export function nameTile(name: string, dark: boolean): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  const hue = 38 + (sum % 92);
  return `oklch(${dark ? "0.32" : "0.7"} 0.06 ${hue.toString()})`;
}
