import type { Category } from "../../category/types.js";
import type { Recipe } from "../../recipe/types.js";
import type { RecipeUid, CategoryUid } from "../../ids.js";

let recipeCounter = 0;
let categoryCounter = 0;

type RecipeOverrides = Partial<Omit<Recipe, "categories">> & { readonly categories?: ReadonlyArray<string> };

export function makeRecipe(overrides?: RecipeOverrides): Recipe {
  recipeCounter++;
  const { categories, ...rest } = overrides ?? {};
  const uid = (rest.uid ?? `recipe-${String(recipeCounter)}`) as RecipeUid;
  return {
    uid,
    hash: `hash-${uid}`,
    name: `Recipe ${String(recipeCounter)}`,
    categories: [...(categories ?? [])] as Array<CategoryUid>,
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
    deleted: false,
    ...rest,
  };
}

type CategoryOverrides = Partial<Omit<Category, "parentUid">> & { readonly parentUid?: string | null };

export function makeCategory(overrides?: CategoryOverrides): Category {
  categoryCounter++;
  const { parentUid, ...rest } = overrides ?? {};
  const uid = (rest.uid ?? `category-${String(categoryCounter)}`) as CategoryUid;
  return {
    uid,
    name: `Category ${String(categoryCounter)}`,
    orderFlag: categoryCounter,
    parentUid: (parentUid ?? null) as CategoryUid | null,
    ...rest,
  };
}

/**
 * Produces a recipe in the Paprika API snake_case wire format (pre-schema-transform).
 * Used by client.test.ts and sync-tool-pipeline integration tests that mock raw API responses.
 */
export function makeSnakeCaseRecipe(uid: string, overrides?: Partial<Record<string, unknown>>): object {
  return {
    uid,
    hash: `hash-${uid}`,
    name: `Recipe ${uid}`,
    categories: [],
    ingredients: "eggs, flour",
    directions: "Mix and bake.",
    description: null,
    notes: null,
    prep_time: null,
    cook_time: null,
    total_time: null,
    servings: null,
    difficulty: null,
    rating: 0,
    created: "2024-01-01T00:00:00Z",
    image_url: "",
    photo: null,
    photo_hash: null,
    photo_large: null,
    photo_url: null,
    source: null,
    source_url: null,
    on_favorites: false,
    in_trash: false,
    is_pinned: false,
    on_grocery_list: false,
    scale: null,
    nutritional_info: null,
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
