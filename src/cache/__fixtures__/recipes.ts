import type { Recipe, Category } from "../../paprika/types.js";
import type { RecipeUid, CategoryUid } from "../../paprika/types.js";

let recipeCounter = 0;
let categoryCounter = 0;

export function makeRecipe(overrides?: Partial<Recipe>): Recipe {
  recipeCounter++;
  const uid = (overrides?.uid ?? `recipe-${String(recipeCounter)}`) as RecipeUid;
  return {
    uid,
    hash: `hash-${uid}`,
    name: `Recipe ${String(recipeCounter)}`,
    categories: [] as Array<CategoryUid>,
    ingredients: "",
    directions: "",
    description: null,
    notes: null,
    prepTime: null,
    cookTime: null,
    totalTime: null,
    servings: null,
    difficulty: null,
    rating: 0,
    created: "2026-01-01T00:00:00Z",
    imageUrl: "",
    photo: null,
    photoHash: null,
    photoLarge: null,
    photoUrl: null,
    source: null,
    sourceUrl: null,
    onFavorites: false,
    inTrash: false,
    isPinned: false,
    onGroceryList: false,
    scale: null,
    nutritionalInfo: null,
    ...overrides,
  };
}

export function makeCategory(overrides?: Partial<Category>): Category {
  categoryCounter++;
  const uid = (overrides?.uid ?? `category-${String(categoryCounter)}`) as CategoryUid;
  return {
    uid,
    name: `Category ${String(categoryCounter)}`,
    orderFlag: categoryCounter,
    parentUid: null,
    ...overrides,
  };
}

/** A trashed recipe for edge-case tests. */
export const TRASHED_RECIPE = makeRecipe({
  uid: "trashed-1" as RecipeUid,
  name: "Trashed Recipe",
  inTrash: true,
});

/** A recipe with all nullable text fields populated — useful for search tests. */
export const FULLY_POPULATED_RECIPE = makeRecipe({
  uid: "full-1" as RecipeUid,
  name: "Fully Populated",
  ingredients: "flour, sugar, butter",
  directions: "Mix and bake.",
  description: "A simple recipe",
  notes: "Best served warm",
  prepTime: "15 min",
  cookTime: "30 min",
  totalTime: "45 min",
  servings: "4",
  difficulty: "Easy",
  rating: 5,
});
