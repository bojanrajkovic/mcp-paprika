import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RecipeStore } from "./recipe-store.js";
import { makeRecipe, makeCategory } from "./__fixtures__/recipes.js";
import type { RecipeUid, CategoryUid } from "../paprika/types.js";

describe("RecipeStore", () => {
  let store: RecipeStore;

  beforeEach(() => {
    store = new RecipeStore();
  });

  describe("recipe-query-store.AC1: CRUD operations", () => {
    describe("recipe-query-store.AC1.1: load() populates both Maps correctly", () => {
      it("recipe-query-store.AC1.1: load() populates both Maps correctly", () => {
        const recipes = [makeRecipe(), makeRecipe()];
        const categories = [makeCategory(), makeCategory()];

        store.load(recipes, categories);

        const recipe0 = store.get(recipes[0]!.uid);
        const recipe1 = store.get(recipes[1]!.uid);
        const cat0 = store.getCategory(categories[0]!.uid);
        const cat1 = store.getCategory(categories[1]!.uid);

        expect(recipe0).toBe(recipes[0]);
        expect(recipe1).toBe(recipes[1]);
        expect(cat0).toBe(categories[0]);
        expect(cat1).toBe(categories[1]);
      });
    });

    describe("recipe-query-store.AC1.2: get() returns recipe with matching UID", () => {
      it("recipe-query-store.AC1.2: get() returns recipe with matching UID", () => {
        const recipe = makeRecipe();
        store.load([recipe], []);

        const result = store.get(recipe.uid);

        expect(result).toBe(recipe);
      });
    });

    describe("recipe-query-store.AC1.3: get() returns undefined for nonexistent UID", () => {
      it("recipe-query-store.AC1.3: get('nonexistent') returns undefined", () => {
        store.load([], []);

        const result = store.get("nonexistent" as RecipeUid);

        expect(result).toBeUndefined();
      });
    });

    describe("recipe-query-store.AC1.4 & AC1.5: getAll() returns only non-trashed recipes", () => {
      it("recipe-query-store.AC1.4: getAll() returns all recipes where inTrash === false", () => {
        const nonTrashed1 = makeRecipe();
        const nonTrashed2 = makeRecipe();
        const trashed = makeRecipe({ inTrash: true });

        store.load([nonTrashed1, nonTrashed2, trashed], []);

        const results = store.getAll();

        expect(results).toHaveLength(2);
        expect(results).toContain(nonTrashed1);
        expect(results).toContain(nonTrashed2);
      });

      it("recipe-query-store.AC1.5: getAll() excludes recipes where inTrash === true", () => {
        const nonTrashed = makeRecipe();
        const trashed = makeRecipe({ inTrash: true });

        store.load([nonTrashed, trashed], []);

        const results = store.getAll();

        expect(results).not.toContain(trashed);
      });
    });

    describe("recipe-query-store.AC1.6: set() adds a new recipe", () => {
      it("recipe-query-store.AC1.6: set(recipe) adds a new recipe; get(recipe.uid) retrieves it", () => {
        const recipe = makeRecipe();

        store.set(recipe);
        const result = store.get(recipe.uid);

        expect(result).toBe(recipe);
      });
    });

    describe("recipe-query-store.AC1.7: set() overwrites existing recipe with same UID", () => {
      it("recipe-query-store.AC1.7: set(recipe) overwrites an existing recipe with the same UID", () => {
        const uid = "recipe-test" as RecipeUid;
        const original = makeRecipe({ uid, name: "Original" });
        const updated = makeRecipe({ uid, name: "Updated" });

        store.set(original);
        store.set(updated);
        const result = store.get(uid);

        expect(result).toBe(updated);
        expect(result?.name).toBe("Updated");
      });
    });

    describe("recipe-query-store.AC1.8: delete() removes the recipe", () => {
      it("recipe-query-store.AC1.8: delete(uid) removes the recipe; subsequent get(uid) returns undefined", () => {
        const recipe = makeRecipe();

        store.set(recipe);
        store.delete(recipe.uid);
        const result = store.get(recipe.uid);

        expect(result).toBeUndefined();
      });
    });

    describe("recipe-query-store.AC1.9: delete() does not throw on nonexistent UID", () => {
      it("recipe-query-store.AC1.9: delete('nonexistent') does not throw", () => {
        expect(() => {
          store.delete("nonexistent" as RecipeUid);
        }).not.toThrow();
      });
    });

    describe("recipe-query-store.AC1.10: size is 0 on fresh store", () => {
      it("recipe-query-store.AC1.10: size returns 0 on a fresh store", () => {
        expect(store.size).toBe(0);
      });
    });

    describe("recipe-query-store.AC1.11: size counts only non-trashed recipes", () => {
      it("recipe-query-store.AC1.11: size returns count of non-trashed recipes only", () => {
        const nonTrashed1 = makeRecipe();
        const nonTrashed2 = makeRecipe();
        const trashed = makeRecipe({ inTrash: true });

        store.load([nonTrashed1, nonTrashed2, trashed], []);

        expect(store.size).toBe(2);
      });
    });

    describe("recipe-query-store.AC1.12: size reflects loaded recipes", () => {
      it("recipe-query-store.AC1.12: After load(), size reflects the number of non-trashed recipes in the input", () => {
        const recipes = [makeRecipe(), makeRecipe({ inTrash: true }), makeRecipe()];

        store.load(recipes, []);

        expect(store.size).toBe(2);
      });
    });
  });

  describe("recipe-query-store.AC2: Category operations", () => {
    describe("recipe-query-store.AC2.1: resolveCategories returns names for existing UIDs", () => {
      it("recipe-query-store.AC2.1: resolveCategories(['uid-1', 'uid-2']) returns ['Name1', 'Name2'] when both exist", () => {
        const cat1 = makeCategory({ uid: "uid-1" as CategoryUid, name: "Name1" });
        const cat2 = makeCategory({ uid: "uid-2" as CategoryUid, name: "Name2" });

        store.load([], [cat1, cat2]);
        const result = store.resolveCategories(["uid-1" as CategoryUid, "uid-2" as CategoryUid]);

        expect(result).toEqual(["Name1", "Name2"]);
      });
    });

    describe("recipe-query-store.AC2.2: resolveCategories drops unknown UIDs", () => {
      it("recipe-query-store.AC2.2: resolveCategories(['uid-1', 'unknown']) returns ['Name1'] (unknown UID dropped)", () => {
        const cat1 = makeCategory({ uid: "uid-1" as CategoryUid, name: "Name1" });

        store.load([], [cat1]);
        const result = store.resolveCategories(["uid-1" as CategoryUid, "unknown" as CategoryUid]);

        expect(result).toEqual(["Name1"]);
      });
    });

    describe("recipe-query-store.AC2.3: resolveCategories returns empty for empty input", () => {
      it("recipe-query-store.AC2.3: resolveCategories([]) returns []", () => {
        store.load([], []);
        const result = store.resolveCategories([]);

        expect(result).toEqual([]);
      });
    });

    describe("recipe-query-store.AC2.4: setCategories replaces all categories", () => {
      it("recipe-query-store.AC2.4: setCategories(categories) replaces all categories; getCategory() reflects the new set", () => {
        const oldCat = makeCategory({ uid: "old" as CategoryUid, name: "Old" });
        const newCat1 = makeCategory({ uid: "new-1" as CategoryUid, name: "New1" });
        const newCat2 = makeCategory({ uid: "new-2" as CategoryUid, name: "New2" });

        store.load([], [oldCat]);
        store.setCategories([newCat1, newCat2]);

        expect(store.getCategory("old" as CategoryUid)).toBeUndefined();
        expect(store.getCategory(newCat1.uid)).toBe(newCat1);
        expect(store.getCategory(newCat2.uid)).toBe(newCat2);
      });
    });

    describe("recipe-query-store.AC2.5: getAllCategories returns all in insertion order", () => {
      it("recipe-query-store.AC2.5: getAllCategories() returns all categories in insertion order", () => {
        const cat1 = makeCategory({ uid: "cat-1" as CategoryUid });
        const cat2 = makeCategory({ uid: "cat-2" as CategoryUid });
        const cat3 = makeCategory({ uid: "cat-3" as CategoryUid });

        store.load([], [cat1, cat2, cat3]);
        const result = store.getAllCategories();

        expect(result).toEqual([cat1, cat2, cat3]);
      });
    });

    describe("recipe-query-store.AC2.6: getCategory returns matching category", () => {
      it("recipe-query-store.AC2.6: getCategory(uid) returns the category with matching UID", () => {
        const cat = makeCategory();

        store.load([], [cat]);
        const result = store.getCategory(cat.uid);

        expect(result).toBe(cat);
      });
    });
  });

  describe("recipe-query-store.AC3: Search method", () => {
    describe("recipe-query-store.AC3.1: Case-insensitive substring match finds recipes by name", () => {
      it("finds recipes with substring match in name", () => {
        const recipe1 = makeRecipe({ uid: "r1" as RecipeUid, name: "Chocolate Cake" });
        const recipe2 = makeRecipe({ uid: "r2" as RecipeUid, name: "Carrot Cake" });
        const recipe3 = makeRecipe({ uid: "r3" as RecipeUid, name: "Brownies" });

        store.load([recipe1, recipe2, recipe3], []);
        const results = store.search("cake");

        expect(results).toHaveLength(2);
        const uids = new Set(results.map((r) => r.recipe.uid));
        expect(uids).toEqual(new Set(["r1", "r2"]));
      });
    });

    describe("recipe-query-store.AC3.2: With fields 'all', searches all fields", () => {
      it("finds recipes by description when fields='all'", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Recipe One",
          description: "Contains special term",
        });

        store.load([recipe], []);
        const results = store.search("special", { fields: "all" });

        expect(results).toHaveLength(1);
        expect(results[0]!.recipe.uid).toBe("r1");
      });

      it("finds recipes by notes when fields='all'", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Recipe One",
          notes: "Contains special note",
        });

        store.load([recipe], []);
        const results = store.search("special", { fields: "all" });

        expect(results).toHaveLength(1);
        expect(results[0]!.recipe.uid).toBe("r1");
      });

      it("finds recipes by ingredients when fields='all'", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Recipe One",
          ingredients: "flour, sugar, special ingredient",
        });

        store.load([recipe], []);
        const results = store.search("special", { fields: "all" });

        expect(results).toHaveLength(1);
        expect(results[0]!.recipe.uid).toBe("r1");
      });
    });

    describe("recipe-query-store.AC3.3: Field scoping limits search to specified field", () => {
      it("finds recipes only in ingredients when fields='ingredients'", () => {
        const recipe1 = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Chocolate Cake",
          ingredients: "chocolate, flour",
        });
        const recipe2 = makeRecipe({
          uid: "r2" as RecipeUid,
          name: "Chocolate Brownie",
          ingredients: "butter, eggs",
        });

        store.load([recipe1, recipe2], []);
        const results = store.search("chocolate", { fields: "ingredients" });

        expect(results).toHaveLength(1);
        expect(results[0]!.recipe.uid).toBe("r1");
      });

      it("finds recipes only in name when fields='name'", () => {
        const recipe1 = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Chocolate Cake",
          ingredients: "flour, sugar",
        });
        const recipe2 = makeRecipe({
          uid: "r2" as RecipeUid,
          name: "Carrot Cake",
          ingredients: "chocolate, flour",
        });

        store.load([recipe1, recipe2], []);
        const results = store.search("chocolate", { fields: "name" });

        expect(results).toHaveLength(1);
        expect(results[0]!.recipe.uid).toBe("r1");
      });
    });

    describe("recipe-query-store.AC3.4: Scoring (exact=3, starts-with=2, contains=1, other-field=0)", () => {
      it("scores exact name match as 3, starts-with as 2, contains as 1, other-field as 0", () => {
        const exact = makeRecipe({
          uid: "exact" as RecipeUid,
          name: "Cake",
          ingredients: "flour",
        });
        const startsWith = makeRecipe({
          uid: "starts" as RecipeUid,
          name: "Cake Mix",
          ingredients: "flour",
        });
        const contains = makeRecipe({
          uid: "contains" as RecipeUid,
          name: "Chocolate Cake",
          ingredients: "flour",
        });
        const otherField = makeRecipe({
          uid: "other" as RecipeUid,
          name: "Brownies",
          ingredients: "cake flour",
        });

        store.load([exact, startsWith, contains, otherField], []);
        const results = store.search("cake");

        expect(results).toHaveLength(4);
        expect(results[0]!.score).toBe(3);
        expect(results[1]!.score).toBe(2);
        expect(results[2]!.score).toBe(1);
        expect(results[3]!.score).toBe(0);
      });

      it("scores description/notes matches as 0, not by name tier", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Brownies",
          description: "Cake-like brownie",
        });

        store.load([recipe], []);
        const results = store.search("cake");

        expect(results).toHaveLength(1);
        expect(results[0]!.score).toBe(0);
      });
    });

    describe("recipe-query-store.AC3.5: Results sorted by score descending, then name ascending", () => {
      it("sorts by score descending, then name ascending within same score", () => {
        const score3 = makeRecipe({
          uid: "s3" as RecipeUid,
          name: "Cake",
        });
        const score2A = makeRecipe({
          uid: "s2a" as RecipeUid,
          name: "Cake Apple",
        });
        const score2B = makeRecipe({
          uid: "s2b" as RecipeUid,
          name: "Cake Brownie",
        });
        const score1A = makeRecipe({
          uid: "s1a" as RecipeUid,
          name: "Apple Cake",
        });
        const score1B = makeRecipe({
          uid: "s1b" as RecipeUid,
          name: "Brownie Cake",
        });
        const score0A = makeRecipe({
          uid: "s0a" as RecipeUid,
          name: "Aaa",
          ingredients: "cake",
        });
        const score0B = makeRecipe({
          uid: "s0b" as RecipeUid,
          name: "Zzz",
          ingredients: "cake",
        });

        store.load([score3, score2A, score2B, score1A, score1B, score0A, score0B], []);
        const results = store.search("cake");

        expect(results).toHaveLength(7);
        // Score 3 (exact match)
        expect(results[0]!.score).toBe(3);
        expect(results[0]!.recipe.uid).toBe("s3");
        // Score 2 (starts-with match), sorted by name
        const score2Results = results.filter((r) => r.score === 2);
        expect(score2Results).toHaveLength(2);
        expect(score2Results[0]!.recipe.name).toBe("Cake Apple");
        expect(score2Results[1]!.recipe.name).toBe("Cake Brownie");
        // Score 1 (contains match), sorted by name
        const score1Results = results.filter((r) => r.score === 1);
        expect(score1Results).toHaveLength(2);
        expect(score1Results[0]!.recipe.name).toBe("Apple Cake");
        expect(score1Results[1]!.recipe.name).toBe("Brownie Cake");
        // Score 0 (other field match), sorted by name
        const score0Results = results.filter((r) => r.score === 0);
        expect(score0Results).toHaveLength(2);
        expect(score0Results[0]!.recipe.name).toBe("Aaa");
        expect(score0Results[1]!.recipe.name).toBe("Zzz");
      });
    });

    describe("recipe-query-store.AC3.6: Pagination with offset and limit", () => {
      it("applies offset and limit correctly", () => {
        const recipes = [
          makeRecipe({ uid: "r1" as RecipeUid, name: "Cake A" }),
          makeRecipe({ uid: "r2" as RecipeUid, name: "Cake B" }),
          makeRecipe({ uid: "r3" as RecipeUid, name: "Cake C" }),
          makeRecipe({ uid: "r4" as RecipeUid, name: "Cake D" }),
          makeRecipe({ uid: "r5" as RecipeUid, name: "Cake E" }),
        ];

        store.load(recipes, []);
        const results = store.search("cake", { offset: 1, limit: 2 });

        expect(results).toHaveLength(2);
        expect(results[0]!.recipe.uid).toBe("r2");
        expect(results[1]!.recipe.uid).toBe("r3");
      });

      it("defaults offset to 0 and limit to no limit", () => {
        const recipes = [
          makeRecipe({ uid: "r1" as RecipeUid, name: "Cake A" }),
          makeRecipe({ uid: "r2" as RecipeUid, name: "Cake B" }),
        ];

        store.load(recipes, []);
        const results = store.search("cake");

        expect(results).toHaveLength(2);
      });
    });

    describe("recipe-query-store.AC3.7: Empty query returns all non-trashed recipes with score 0", () => {
      it("returns all non-trashed recipes with score 0 when query is empty", () => {
        const recipe1 = makeRecipe({ uid: "r1" as RecipeUid, name: "Recipe One" });
        const recipe2 = makeRecipe({ uid: "r2" as RecipeUid, name: "Recipe Two" });

        store.load([recipe1, recipe2], []);
        const results = store.search("");

        expect(results).toHaveLength(2);
        expect(results.every((r) => r.score === 0)).toBe(true);
      });
    });

    describe("recipe-query-store.AC3.8: Trashed recipes never appear in search results", () => {
      it("excludes trashed recipes from search results", () => {
        const normal = makeRecipe({
          uid: "normal" as RecipeUid,
          name: "Chocolate Cake",
        });
        const trashed = makeRecipe({
          uid: "trashed" as RecipeUid,
          name: "Chocolate Trashed",
          inTrash: true,
        });

        store.load([normal, trashed], []);
        const results = store.search("chocolate");

        expect(results).toHaveLength(1);
        expect(results[0]!.recipe.uid).toBe("normal");
      });
    });
  });

  describe("recipe-query-store.AC4: Ingredient filtering", () => {
    describe("recipe-query-store.AC4.1: 'all' mode returns only recipes containing every search term", () => {
      it("returns recipes with all search terms in 'all' mode", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          ingredients: "flour, sugar, butter",
        });
        const noMatch = makeRecipe({
          uid: "r2" as RecipeUid,
          ingredients: "flour, chocolate",
        });

        store.load([recipe, noMatch], []);
        const results = store.filterByIngredients(["flour", "sugar"], "all");

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("r1");
      });

      it("excludes recipes missing any search term in 'all' mode", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          ingredients: "flour, sugar, butter",
        });

        store.load([recipe], []);
        const results = store.filterByIngredients(["flour", "chocolate"], "all");

        expect(results).toHaveLength(0);
      });
    });

    describe("recipe-query-store.AC4.2: 'any' mode returns recipes containing at least one search term", () => {
      it("returns recipes with any search term in 'any' mode", () => {
        const recipe1 = makeRecipe({
          uid: "r1" as RecipeUid,
          ingredients: "flour, sugar",
        });
        const recipe2 = makeRecipe({
          uid: "r2" as RecipeUid,
          ingredients: "chocolate, butter",
        });

        store.load([recipe1, recipe2], []);
        const results = store.filterByIngredients(["flour", "chocolate"], "any");

        expect(results).toHaveLength(2);
      });
    });

    describe("recipe-query-store.AC4.3: Matching is case-insensitive", () => {
      it("matches ingredients case-insensitively", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          ingredients: "flour, sugar",
        });

        store.load([recipe], []);
        const results = store.filterByIngredients(["FLOUR"], "any");

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("r1");
      });
    });

    describe("recipe-query-store.AC4.4: limit parameter caps the number of results", () => {
      it("returns only limit recipes when specified", () => {
        const recipes = [
          makeRecipe({ uid: "r1" as RecipeUid, ingredients: "flour" }),
          makeRecipe({ uid: "r2" as RecipeUid, ingredients: "flour" }),
          makeRecipe({ uid: "r3" as RecipeUid, ingredients: "flour" }),
        ];

        store.load(recipes, []);
        const results = store.filterByIngredients(["flour"], "any", 2);

        expect(results).toHaveLength(2);
      });
    });

    describe("recipe-query-store.AC4.5: Empty terms array returns all non-trashed recipes", () => {
      it("returns all non-trashed recipes when terms array is empty", () => {
        const recipe1 = makeRecipe({ uid: "r1" as RecipeUid });
        const recipe2 = makeRecipe({ uid: "r2" as RecipeUid });

        store.load([recipe1, recipe2], []);
        const results = store.filterByIngredients([], "all");

        expect(results).toHaveLength(2);
      });
    });

    describe("recipe-query-store.AC4.6: Trashed recipes never appear in filtered results", () => {
      it("excludes trashed recipes from filtered results", () => {
        const normal = makeRecipe({
          uid: "normal" as RecipeUid,
          ingredients: "flour",
        });
        const trashed = makeRecipe({
          uid: "trashed" as RecipeUid,
          ingredients: "flour, sugar",
          inTrash: true,
        });

        store.load([normal, trashed], []);
        const results = store.filterByIngredients(["flour"], "any");

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("normal");
      });
    });
  });

  describe("recipe-query-store.AC5: Time filtering", () => {
    describe("recipe-query-store.AC5.1: Filters recipes by maxPrepTime constraint", () => {
      it("excludes recipes where prepTime exceeds maxPrepTime", () => {
        const included = makeRecipe({
          uid: "r1" as RecipeUid,
          prepTime: "10 min",
          totalTime: "10 min",
        });
        const excluded = makeRecipe({
          uid: "r2" as RecipeUid,
          prepTime: "30 min",
          totalTime: "30 min",
        });

        store.load([included, excluded], []);
        const results = store.filterByTime({ maxPrepTime: 20 });

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("r1");
      });

      it("includes recipes where prepTime is within maxPrepTime", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          prepTime: "10 min",
          totalTime: "10 min",
        });

        store.load([recipe], []);
        const results = store.filterByTime({ maxPrepTime: 20 });

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("r1");
      });
    });

    describe("recipe-query-store.AC5.2: Filters recipes by maxCookTime constraint", () => {
      it("excludes recipes where cookTime exceeds maxCookTime", () => {
        const included = makeRecipe({
          uid: "r1" as RecipeUid,
          cookTime: "30 min",
          totalTime: "30 min",
        });
        const excluded = makeRecipe({
          uid: "r2" as RecipeUid,
          cookTime: "90 min",
          totalTime: "90 min",
        });

        store.load([included, excluded], []);
        const results = store.filterByTime({ maxCookTime: 60 });

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("r1");
      });
    });

    describe("recipe-query-store.AC5.3: Filters recipes by maxTotalTime constraint", () => {
      it("excludes recipes where totalTime exceeds maxTotalTime", () => {
        const included = makeRecipe({
          uid: "r1" as RecipeUid,
          totalTime: "30 min",
        });
        const excluded = makeRecipe({
          uid: "r2" as RecipeUid,
          totalTime: "90 min",
        });

        store.load([included, excluded], []);
        const results = store.filterByTime({ maxTotalTime: 60 });

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("r1");
      });
    });

    describe("recipe-query-store.AC5.4: Multiple constraints applied simultaneously (all must pass)", () => {
      it("excludes recipes that fail any constraint", () => {
        const passAll = makeRecipe({
          uid: "r1" as RecipeUid,
          prepTime: "10 min",
          cookTime: "30 min",
          totalTime: "40 min",
        });
        const failCook = makeRecipe({
          uid: "r2" as RecipeUid,
          prepTime: "10 min",
          cookTime: "60 min",
          totalTime: "70 min",
        });

        store.load([passAll, failCook], []);
        const results = store.filterByTime({
          maxPrepTime: 15,
          maxCookTime: 45,
          maxTotalTime: 50,
        });

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("r1");
      });
    });

    describe("recipe-query-store.AC5.5: Recipes with unparseable time strings are kept", () => {
      it("includes recipes with unparseable totalTime", () => {
        const normal = makeRecipe({
          uid: "r1" as RecipeUid,
          totalTime: "30 min",
        });
        const unparseable = makeRecipe({
          uid: "r2" as RecipeUid,
          totalTime: "not a real time",
        });

        store.load([normal, unparseable], []);
        const results = store.filterByTime({ maxTotalTime: 60 });

        expect(results).toHaveLength(2);
        expect(new Set(results.map((r) => r.uid))).toEqual(new Set(["r1", "r2"]));
      });
    });

    describe("recipe-query-store.AC5.6: Results sorted by totalTime ascending", () => {
      it("sorts recipes by totalTime in ascending order", () => {
        const r60 = makeRecipe({
          uid: "r1" as RecipeUid,
          totalTime: "60 min",
          name: "Recipe 60",
        });
        const r30 = makeRecipe({
          uid: "r2" as RecipeUid,
          totalTime: "30 min",
          name: "Recipe 30",
        });
        const r45 = makeRecipe({
          uid: "r3" as RecipeUid,
          totalTime: "45 min",
          name: "Recipe 45",
        });

        store.load([r60, r30, r45], []);
        const results = store.filterByTime({});

        expect(results).toHaveLength(3);
        expect(results[0]!.uid).toBe("r2"); // 30 min
        expect(results[1]!.uid).toBe("r3"); // 45 min
        expect(results[2]!.uid).toBe("r1"); // 60 min
      });
    });

    describe("recipe-query-store.AC5.7: Unparseable and null totalTime sort last", () => {
      it("sorts unparseable and null totalTime values after parseable ones", () => {
        const parseable = makeRecipe({
          uid: "r1" as RecipeUid,
          totalTime: "30 min",
        });
        const unparseable = makeRecipe({
          uid: "r2" as RecipeUid,
          totalTime: "not a time",
        });
        const nullTime = makeRecipe({
          uid: "r3" as RecipeUid,
          totalTime: null,
        });

        store.load([unparseable, nullTime, parseable], []);
        const results = store.filterByTime({});

        expect(results).toHaveLength(3);
        expect(results[0]!.uid).toBe("r1"); // parseable first
        expect(new Set([results[1]!.uid, results[2]!.uid])).toEqual(new Set(["r2", "r3"])); // unparseable and null last
      });
    });

    describe("recipe-query-store.AC5.8: No constraints returns all non-trashed recipes", () => {
      it("returns all non-trashed recipes when no constraints set", () => {
        const recipe1 = makeRecipe({ uid: "r1" as RecipeUid, totalTime: "30 min" });
        const recipe2 = makeRecipe({ uid: "r2" as RecipeUid, totalTime: "60 min" });

        store.load([recipe1, recipe2], []);
        const results = store.filterByTime({});

        expect(results).toHaveLength(2);
      });
    });

    describe("recipe-query-store.AC5.9: Time parsing delegates to parseDuration", () => {
      it("parses colon format correctly (H:MM)", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          totalTime: "1:30",
        });

        store.load([recipe], []);
        const results = store.filterByTime({ maxTotalTime: 90 });

        expect(results).toHaveLength(1);
      });
    });
  });

  describe("recipe-query-store.AC6: Name lookup", () => {
    describe("recipe-query-store.AC6.1: Exact case-insensitive match returns the matching recipe", () => {
      it("returns the recipe with exact name match (case-insensitive)", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Chocolate Cake",
        });

        store.load([recipe], []);
        const results = store.findByName("chocolate cake");

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("r1");
      });
    });

    describe("recipe-query-store.AC6.2: Starts-with match used when no exact match exists", () => {
      it("returns recipes with starts-with match when no exact match", () => {
        const cake = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Chocolate Cake",
        });
        const cookies = makeRecipe({
          uid: "r2" as RecipeUid,
          name: "Chocolate Chip Cookies",
        });

        store.load([cake, cookies], []);
        const results = store.findByName("chocolate c");

        expect(results).toHaveLength(2);
        const uids = new Set(results.map((r) => r.uid));
        expect(uids).toEqual(new Set(["r1", "r2"]));
      });
    });

    describe("recipe-query-store.AC6.3: Contains match used when no starts-with match exists", () => {
      it("returns recipes with contains match when no exact/starts-with match", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Dark Chocolate Cake",
        });

        store.load([recipe], []);
        const results = store.findByName("chocolate");

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("r1");
      });
    });

    describe("recipe-query-store.AC6.4: Returns all matches at the first successful tier", () => {
      it("returns all start-with matches when multiple exist", () => {
        const pie = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Apple Pie",
        });
        const strudel = makeRecipe({
          uid: "r2" as RecipeUid,
          name: "Apple Strudel",
        });

        store.load([pie, strudel], []);
        const results = store.findByName("apple");

        expect(results).toHaveLength(2);
        const uids = new Set(results.map((r) => r.uid));
        expect(uids).toEqual(new Set(["r1", "r2"]));
      });
    });

    describe("recipe-query-store.AC6.5: No matches at any tier returns empty array", () => {
      it("returns empty array when no matches found", () => {
        const recipe = makeRecipe({
          uid: "r1" as RecipeUid,
          name: "Chocolate Cake",
        });

        store.load([recipe], []);
        const results = store.findByName("nonexistent recipe name");

        expect(results).toHaveLength(0);
      });
    });

    describe("recipe-query-store.AC6.6: Only searches non-trashed recipes", () => {
      it("does not return trashed recipes", () => {
        const normal = makeRecipe({
          uid: "normal" as RecipeUid,
          name: "Chocolate Cake",
        });
        const trashed = makeRecipe({
          uid: "trashed" as RecipeUid,
          name: "Trashed Chocolate",
          inTrash: true,
        });

        store.load([normal, trashed], []);
        const results = store.findByName("chocolate");

        expect(results).toHaveLength(1);
        expect(results[0]!.uid).toBe("normal");
      });
    });
  });

  describe("recipe-query-store.AC7: Module characteristics", () => {
    describe("recipe-query-store.AC7.2: No I/O operations (no fs, http, fetch, etc.)", () => {
      it("does not import I/O modules like fs, http, net, child_process, fetch", () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const srcDir = __dirname.includes("/dist/") ? __dirname.replace("/dist/", "/src/") : __dirname;
        const sourceFilePath = resolve(srcDir, "recipe-store.ts");
        const source = readFileSync(sourceFilePath, "utf-8");

        expect(source).not.toMatch(/from\s+["']node:fs["']/);
        expect(source).not.toMatch(/from\s+["']node:http["']/);
        expect(source).not.toMatch(/from\s+["']node:net["']/);
        expect(source).not.toMatch(/from\s+["']node:child_process["']/);
        expect(source).not.toMatch(/from\s+["']node:fetch["']/);
        expect(source).not.toMatch(/\bfetch\(/);
      });
    });

    describe("recipe-query-store.AC7.3: All methods are synchronous (no async, no Promise)", () => {
      it("does not use async keyword", () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const srcDir = __dirname.includes("/dist/") ? __dirname.replace("/dist/", "/src/") : __dirname;
        const sourceFilePath = resolve(srcDir, "recipe-store.ts");
        const source = readFileSync(sourceFilePath, "utf-8");

        expect(source).not.toMatch(/\basync\b/);
      });

      it("does not use Promise", () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const srcDir = __dirname.includes("/dist/") ? __dirname.replace("/dist/", "/src/") : __dirname;
        const sourceFilePath = resolve(srcDir, "recipe-store.ts");
        const source = readFileSync(sourceFilePath, "utf-8");

        expect(source).not.toMatch(/Promise/);
      });
    });

    describe("recipe-query-store.AC7.4: Imports only from paprika/types and utils/duration (plus npm packages)", () => {
      it("verifies all relative imports match allowed paths", () => {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = dirname(__filename);
        const srcDir = __dirname.includes("/dist/") ? __dirname.replace("/dist/", "/src/") : __dirname;
        const sourceFilePath = resolve(srcDir, "recipe-store.ts");
        const source = readFileSync(sourceFilePath, "utf-8");

        const relativeImports = source.match(/from\s+["'](\.\.[^"']+)["']/g) || [];
        const importPaths = relativeImports.map((line) => line.match(/["']([^"']+)["']/)?.[1]).filter(Boolean);

        for (const importPath of importPaths) {
          expect(importPath).toMatch(/^\.\.\/paprika\/types\.js$|^\.\.\/utils\/duration\.js$/);
        }
      });
    });
  });
});
