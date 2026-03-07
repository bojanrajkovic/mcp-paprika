import type { Recipe, Category, RecipeUid, CategoryUid } from "../paprika/types.js";
import { parseDuration } from "../utils/duration.js";

export type SearchOptions = {
  readonly fields?: "all" | "name" | "ingredients" | "description";
  readonly offset?: number;
  readonly limit?: number;
};

export type ScoredResult = {
  readonly recipe: Recipe;
  readonly score: number;
};

export type TimeConstraints = {
  readonly maxPrepTime?: number;
  readonly maxCookTime?: number;
  readonly maxTotalTime?: number;
};

export class RecipeStore {
  private readonly recipes: Map<RecipeUid, Recipe> = new Map();
  private readonly categories: Map<CategoryUid, Category> = new Map();

  load(recipes: ReadonlyArray<Recipe>, categories: ReadonlyArray<Category>): void {
    this.recipes.clear();
    for (const recipe of recipes) {
      this.recipes.set(recipe.uid, recipe);
    }
    this.categories.clear();
    for (const category of categories) {
      this.categories.set(category.uid, category);
    }
  }

  get(uid: RecipeUid): Recipe | undefined {
    return this.recipes.get(uid);
  }

  getAll(): Array<Recipe> {
    const results: Array<Recipe> = [];
    for (const recipe of this.recipes.values()) {
      if (!recipe.inTrash) {
        results.push(recipe);
      }
    }
    return results;
  }

  set(recipe: Recipe): void {
    this.recipes.set(recipe.uid, recipe);
  }

  delete(uid: RecipeUid): void {
    this.recipes.delete(uid);
  }

  get size(): number {
    let count = 0;
    for (const recipe of this.recipes.values()) {
      if (!recipe.inTrash) {
        count++;
      }
    }
    return count;
  }

  getCategory(uid: CategoryUid): Category | undefined {
    return this.categories.get(uid);
  }

  getAllCategories(): Array<Category> {
    return [...this.categories.values()];
  }

  setCategories(categories: ReadonlyArray<Category>): void {
    this.categories.clear();
    for (const category of categories) {
      this.categories.set(category.uid, category);
    }
  }

  resolveCategories(categoryUids: ReadonlyArray<CategoryUid>): Array<string> {
    const names: Array<string> = [];
    for (const uid of categoryUids) {
      const category = this.categories.get(uid);
      if (category) {
        names.push(category.name);
      }
    }
    return names;
  }

  search(query: string, options?: SearchOptions): Array<ScoredResult> {
    const fields = options?.fields ?? "all";
    const offset = options?.offset ?? 0;
    const limit = options?.limit;
    const lowerQuery = query.toLowerCase();

    const results: Array<ScoredResult> = [];

    for (const recipe of this.recipes.values()) {
      if (recipe.inTrash) continue;

      if (lowerQuery === "") {
        results.push({ recipe, score: 0 });
        continue;
      }

      const lowerName = recipe.name.toLowerCase();
      let score = -1;

      if (fields === "all" || fields === "name") {
        if (lowerName === lowerQuery) {
          score = 3;
        } else if (lowerName.startsWith(lowerQuery)) {
          score = 2;
        } else if (lowerName.includes(lowerQuery)) {
          score = 1;
        }
      }

      if (score === -1 && (fields === "all" || fields === "ingredients")) {
        if (recipe.ingredients.toLowerCase().includes(lowerQuery)) {
          score = 0;
        }
      }

      if (score === -1 && (fields === "all" || fields === "description")) {
        if (recipe.description?.toLowerCase().includes(lowerQuery)) {
          score = 0;
        }
      }

      if (score === -1 && fields === "all") {
        if (recipe.notes?.toLowerCase().includes(lowerQuery)) {
          score = 0;
        }
      }

      if (score >= 0) {
        results.push({ recipe, score });
      }
    }

    results.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.recipe.name.localeCompare(b.recipe.name);
    });

    const sliced = limit !== undefined ? results.slice(offset, offset + limit) : results.slice(offset);

    return sliced;
  }

  filterByIngredients(terms: ReadonlyArray<string>, mode: "all" | "any", limit?: number): Array<Recipe> {
    const recipes = this.getAll();

    if (terms.length === 0) {
      return limit !== undefined ? recipes.slice(0, limit) : recipes;
    }

    const lowerTerms = terms.map((t) => t.toLowerCase());

    const matched = recipes.filter((recipe) => {
      const lowerIngredients = recipe.ingredients.toLowerCase();
      if (mode === "all") {
        return lowerTerms.every((term) => lowerIngredients.includes(term));
      }
      return lowerTerms.some((term) => lowerIngredients.includes(term));
    });

    return limit !== undefined ? matched.slice(0, limit) : matched;
  }

  filterByTime(constraints: TimeConstraints): Array<Recipe> {
    const recipes = this.getAll();

    const hasConstraints =
      constraints.maxPrepTime !== undefined ||
      constraints.maxCookTime !== undefined ||
      constraints.maxTotalTime !== undefined;

    const filtered = hasConstraints
      ? recipes.filter((recipe) => {
          if (constraints.maxPrepTime !== undefined && recipe.prepTime !== null) {
            const parsed = parseDuration(recipe.prepTime);
            if (parsed.isOk() && parsed.value.as("minutes") > constraints.maxPrepTime) {
              return false;
            }
          }
          if (constraints.maxCookTime !== undefined && recipe.cookTime !== null) {
            const parsed = parseDuration(recipe.cookTime);
            if (parsed.isOk() && parsed.value.as("minutes") > constraints.maxCookTime) {
              return false;
            }
          }
          if (constraints.maxTotalTime !== undefined && recipe.totalTime !== null) {
            const parsed = parseDuration(recipe.totalTime);
            if (parsed.isOk() && parsed.value.as("minutes") > constraints.maxTotalTime) {
              return false;
            }
          }
          return true;
        })
      : recipes;

    return filtered.toSorted((a, b) => {
      const aMinutes = parseTotalTimeMinutes(a.totalTime);
      const bMinutes = parseTotalTimeMinutes(b.totalTime);

      if (aMinutes === null && bMinutes === null) return 0;
      if (aMinutes === null) return 1;
      if (bMinutes === null) return -1;
      return aMinutes - bMinutes;
    });
  }

  findByName(title: string): Array<Recipe> {
    const recipes = this.getAll();
    const lowerTitle = title.toLowerCase();

    const exact = recipes.filter((r) => r.name.toLowerCase() === lowerTitle);
    if (exact.length > 0) return exact;

    const startsWith = recipes.filter((r) => r.name.toLowerCase().startsWith(lowerTitle));
    if (startsWith.length > 0) return startsWith;

    const contains = recipes.filter((r) => r.name.toLowerCase().includes(lowerTitle));
    return contains;
  }
}

function parseTotalTimeMinutes(totalTime: string | null): number | null {
  if (totalTime === null) return null;
  const result = parseDuration(totalTime);
  if (result.isErr()) return null;
  return result.value.as("minutes");
}
