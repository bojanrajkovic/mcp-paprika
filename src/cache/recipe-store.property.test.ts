import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { RecipeStore } from "./recipe-store.js";
import { makeRecipe } from "./__fixtures__/recipes.js";
import type { RecipeUid } from "../paprika/types.js";

describe("RecipeStore property-based tests", () => {
  describe("recipe-query-store.AC3.5 & AC3.8: Search result ordering invariant and trashed recipes", () => {
    it("Property 1: Search results are always sorted by score descending, then name ascending", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 20 }), (query) => {
          const store = new RecipeStore();

          const recipes = [
            makeRecipe({ uid: "r1" as RecipeUid, name: "Apple Pie" }),
            makeRecipe({ uid: "r2" as RecipeUid, name: "Apple Cake" }),
            makeRecipe({ uid: "r3" as RecipeUid, name: "Banana Apple" }),
            makeRecipe({ uid: "r4" as RecipeUid, name: "Cherry Pie" }),
            makeRecipe({ uid: "r5" as RecipeUid, name: "Apple" }),
          ];

          store.load(recipes, []);
          const results = store.search(query);

          for (let i = 0; i < results.length - 1; i++) {
            const current = results[i]!;
            const next = results[i + 1]!;
            expect(current.score).toBeGreaterThanOrEqual(next.score);
            if (current.score === next.score) {
              expect(current.recipe.name.localeCompare(next.recipe.name)).toBeLessThanOrEqual(0);
            }
          }
        }),
      );
    });

    it("Property 2: Search never returns trashed recipes", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 0, maxLength: 20 }), (query) => {
          const store = new RecipeStore();

          const normal = makeRecipe({ uid: "normal" as RecipeUid, name: "Normal Recipe" });
          const trashed = makeRecipe({ uid: "trashed" as RecipeUid, name: "Trashed Recipe", inTrash: true });

          store.load([normal, trashed], []);
          const results = store.search(query);

          for (const result of results) {
            expect(result.recipe.inTrash).toBe(false);
          }
        }),
      );
    });
  });

  describe("recipe-query-store.AC4.6: Trashed recipes never appear in filterByIngredients", () => {
    it("Property 3: filterByIngredients never returns trashed recipes", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 20 }), (term) => {
          const store = new RecipeStore();

          const normal = makeRecipe({
            uid: "normal" as RecipeUid,
            name: "Normal Recipe",
            ingredients: "flour, sugar, butter",
          });
          const trashed = makeRecipe({
            uid: "trashed" as RecipeUid,
            name: "Trashed Recipe",
            ingredients: "flour, sugar, butter",
            inTrash: true,
          });

          store.load([normal, trashed], []);
          const results = store.filterByIngredients([term], "any");

          for (const recipe of results) {
            expect(recipe.inTrash).toBe(false);
          }
        }),
      );
    });
  });

  describe("recipe-query-store.AC5.5: filterByTime keeps unparseable recipes", () => {
    it("Property 4: Recipes with unparseable time strings are kept in results", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 1000 }), (maxMinutes) => {
          const store = new RecipeStore();

          const parseable = makeRecipe({
            uid: "good" as RecipeUid,
            name: "Good Recipe",
            totalTime: "30 min",
          });
          const unparseable = makeRecipe({
            uid: "bad" as RecipeUid,
            name: "Bad Recipe",
            totalTime: "not a real time",
          });

          store.load([parseable, unparseable], []);
          const results = store.filterByTime({ maxTotalTime: maxMinutes });

          const resultUids = new Set(results.map((r) => r.uid));
          expect(resultUids).toContain("bad");
        }),
      );
    });
  });

  describe("recipe-query-store.AC6.6: findByName never returns trashed recipes", () => {
    it("Property 5: findByName never returns trashed recipes", () => {
      fc.assert(
        fc.property(fc.string({ minLength: 1, maxLength: 20 }), (title) => {
          const store = new RecipeStore();

          const normal = makeRecipe({
            uid: "normal" as RecipeUid,
            name: "Chocolate Cake",
          });
          const trashed = makeRecipe({
            uid: "trashed" as RecipeUid,
            name: "Chocolate Brownies",
            inTrash: true,
          });

          store.load([normal, trashed], []);
          const results = store.findByName(title);

          for (const recipe of results) {
            expect(recipe.inTrash).toBe(false);
          }
        }),
      );
    });
  });
});
