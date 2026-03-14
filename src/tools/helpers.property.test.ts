import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { recipeToMarkdown } from "./helpers.js";
import type { Recipe, RecipeUid, CategoryUid } from "../paprika/types.js";

const arbitraryRecipe = fc.record({
  uid: fc.string().map((s) => s as RecipeUid),
  hash: fc.string(),
  name: fc.string({ minLength: 1 }),
  categories: fc.array(fc.string().map((s) => s as CategoryUid)),
  ingredients: fc.string(),
  directions: fc.string(),
  description: fc.option(fc.string(), { nil: null }),
  notes: fc.option(fc.string(), { nil: null }),
  prepTime: fc.option(fc.string(), { nil: null }),
  cookTime: fc.option(fc.string(), { nil: null }),
  totalTime: fc.option(fc.string(), { nil: null }),
  servings: fc.option(fc.string(), { nil: null }),
  difficulty: fc.option(fc.string(), { nil: null }),
  rating: fc.integer({ min: 0, max: 5 }),
  created: fc.string(),
  imageUrl: fc.string(),
  photo: fc.option(fc.string(), { nil: null }),
  photoHash: fc.option(fc.string(), { nil: null }),
  photoLarge: fc.option(fc.string(), { nil: null }),
  photoUrl: fc.option(fc.string(), { nil: null }),
  source: fc.option(fc.string(), { nil: null }),
  sourceUrl: fc.option(fc.string(), { nil: null }),
  onFavorites: fc.boolean(),
  inTrash: fc.boolean(),
  isPinned: fc.boolean(),
  onGroceryList: fc.boolean(),
  scale: fc.option(fc.string(), { nil: null }),
  nutritionalInfo: fc.option(fc.string(), { nil: null }),
} as Record<keyof Recipe, fc.Arbitrary<unknown>>);

const arbitraryCategoryNames = fc.array(fc.string());

describe("p2-u02-shared-helpers.AC3.7: recipeToMarkdown structural invariants", () => {
  it("Property 1: output always starts with # {recipe.name}", () => {
    fc.assert(
      fc.property(arbitraryRecipe, arbitraryCategoryNames, (recipe, categoryNames) => {
        const output = recipeToMarkdown(recipe, categoryNames);
        expect(output.startsWith(`# ${recipe.name}`)).toBe(true);
      }),
    );
  });

  it("Property 2: output always contains ## Ingredients", () => {
    fc.assert(
      fc.property(arbitraryRecipe, arbitraryCategoryNames, (recipe, categoryNames) => {
        const output = recipeToMarkdown(recipe, categoryNames);
        expect(output).toContain("## Ingredients");
      }),
    );
  });

  it("Property 3: output always contains ## Directions", () => {
    fc.assert(
      fc.property(arbitraryRecipe, arbitraryCategoryNames, (recipe, categoryNames) => {
        const output = recipeToMarkdown(recipe, categoryNames);
        expect(output).toContain("## Directions");
      }),
    );
  });
});
