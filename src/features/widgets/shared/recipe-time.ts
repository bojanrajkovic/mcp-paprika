// The one duration a collapsed recipe row surfaces — the most decision-relevant of
// cook → total → prep. Shared by the recipe-browse row and the menu's rich rows so the
// two never disagree on which time to show.
interface RecipeTimes {
  prepTime: string | null;
  cookTime: string | null;
  totalTime: string | null;
}

export function relevantTime(r: RecipeTimes): string | null {
  return r.cookTime ?? r.totalTime ?? r.prepTime;
}
