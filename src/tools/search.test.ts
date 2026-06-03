import { describe, expect, it } from "vitest";

import { makeMeal } from "../../test/cache/__fixtures__/meals.js";
import { makeCategory, makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makePinoCapture, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerSearchTool, searchRecipesInputSchema } from "./search.js";

describe("p2-discovery-tools: search_recipes tool", () => {
  describe("p2-discovery-tools.AC1: search_recipes", () => {
    it("p2-discovery-tools.AC1.1: non-empty store + matching query returns formatted results", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Chocolate Cake" })] }),
      );

      const result = await callTool("search_recipes", {
        query: "chocolate",
        limit: 20,
      });

      expect(getText(result)).toContain("Chocolate Cake");
    });

    it("p2-discovery-tools.AC1.1 (extended): time fields are rendered when populated", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ name: "Pasta Carbonara", prepTime: "10 min", totalTime: "25 min" })],
        }),
      );

      const result = await callTool("search_recipes", {
        query: "pasta",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Prep: 10 min");
      expect(text).toContain("Total: 25 min");
    });

    it("p2-discovery-tools.AC1.2: limit defaults to 20 when store has many matches", async () => {
      const { server, callTool } = makeTestServer();
      // Load 25 recipes all matching "recipe"
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: Array.from({ length: 25 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}` })),
        }),
      );

      // Pass limit: 20 explicitly (mirrors what the SDK provides when caller omits limit,
      // since z.default(20) ensures the handler always receives 20 for omitted limit).
      const result = await callTool("search_recipes", { query: "recipe", limit: 20 });
      const text = getText(result);

      // Count "---" separators: N results produce N-1 separators
      const separators = (text.match(/^---$/gm) ?? []).length;
      expect(separators).toBe(19); // 20 results = 19 separators
    });

    it("p2-discovery-tools.AC1.3: limit caps result count", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}` })),
        }),
      );

      const result = await callTool("search_recipes", {
        query: "recipe",
        limit: 3,
      });
      const text = getText(result);

      const separators = (text.match(/^---$/gm) ?? []).length;
      expect(separators).toBe(2); // 3 results = 2 separators
    });

    it("p2-discovery-tools.AC1.4: category names appear in formatted results", async () => {
      const category = makeCategory({ name: "Dessert" });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Cake", categories: [category.uid] })],
        categories: [category],
      });
      registerSearchTool(server, ctx);

      const result = await callTool("search_recipes", {
        query: "cake",
        limit: 20,
      });

      expect(getText(result)).toContain("Dessert");
    });

    it("p2-discovery-tools.AC1.5: empty store returns cold-start Err payload", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(new RecipeStore(), server)); // not loaded — size === 0

      const result = await callTool("search_recipes", {
        query: "anything",
        limit: 20,
      });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC1.6: no matching recipes returns empty-result message (not an error)", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Pasta Carbonara" })] }),
      );

      const result = await callTool("search_recipes", {
        query: "sushi",
        limit: 20,
      });
      const text = getText(result);

      // Must be a normal text response (not error), containing the query
      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });

    it("p2-discovery-tools.AC1.7-pos: rating appears in search hit when > 0", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Chocolate Cake", rating: 5 })] }),
      );

      const result = await callTool("search_recipes", { query: "chocolate", limit: 20 });
      expect(getText(result)).toContain("5/5");
    });

    it("p2-discovery-tools.AC1.7-neg: rating absent from search hit when 0", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Chocolate Cake", rating: 0 })] }),
      );

      const result = await callTool("search_recipes", { query: "chocolate", limit: 20 });
      expect(getText(result)).not.toContain("/5");
    });

    it("p2-discovery-tools.AC1.8-pos: pinned marker appears in search hit when isPinned is true", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Chocolate Cake", isPinned: true })] }),
      );

      const result = await callTool("search_recipes", { query: "chocolate", limit: 20 });
      expect(getText(result)).toContain("Pinned");
    });

    it("p2-discovery-tools.AC1.8-neg: pinned marker absent from search hit when isPinned is false", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ name: "Chocolate Cake", isPinned: false })],
        }),
      );

      const result = await callTool("search_recipes", { query: "chocolate", limit: 20 });
      expect(getText(result)).not.toContain("Pinned");
    });

    it("p2-discovery-tools.AC1.9-pos: on-grocery-list marker appears in search hit when onGroceryList is true", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ name: "Chocolate Cake", onGroceryList: true })],
        }),
      );

      const result = await callTool("search_recipes", { query: "chocolate", limit: 20 });
      expect(getText(result)).toContain("Grocery List");
    });

    it("p2-discovery-tools.AC1.9-neg: on-grocery-list marker absent from search hit when onGroceryList is false", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ name: "Chocolate Cake", onGroceryList: false })],
        }),
      );

      const result = await callTool("search_recipes", { query: "chocolate", limit: 20 });
      expect(getText(result)).not.toContain("Grocery List");
    });

    it("p2-discovery-tools.AC1.invocation: search_recipes logs invocation at info level with tool name and query", async () => {
      const { log, records } = makePinoCapture();
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server, { log }), { recipes: [makeRecipe({ name: "Chocolate Cake" })] }),
      );

      await callTool("search_recipes", { query: "chocolate", limit: 20 });

      const invocation = records.find((r) => r["msg"] === "tool invoked");
      expect(invocation).toBeDefined();
      expect(invocation?.["tool"]).toBe("search_recipes");
      expect(invocation?.["query"]).toBe("chocolate");
      expect(invocation?.["level"]).toBe(30); // pino info = 30
    });
  });

  describe("lastCookedAt enrichment", () => {
    it("includes Last Cooked in search results when meal history exists", async () => {
      const recipe = makeRecipe({ name: "Chicken Soup", ingredients: "chicken, broth" });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [recipe],
        meals: [makeMeal({ recipeUid: recipe.uid, date: "2026-05-01 00:00:00" })],
      });
      registerSearchTool(server, ctx);

      const result = await callTool("search_recipes", { query: "chicken", limit: 20 });
      expect(getText(result)).toContain("**Last Cooked:** 2026-05-01");
    });
  });

  // ---------------------------------------------------------------------------
  // D7: ingredient filtering on search_recipes
  // ---------------------------------------------------------------------------

  describe("D7: ingredient filtering via search_recipes", () => {
    it("D7.ingredient.1: mode=all returns only recipes with all ingredients", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
            makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
            makeRecipe({ name: "Garlic Bread", ingredients: "bread, garlic, butter" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        ingredients: ["tomato", "garlic"],
        match: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Pasta");
      expect(text).not.toContain("Salad");
      expect(text).not.toContain("Garlic Bread");
    });

    it("D7.ingredient.2: mode=any returns recipes with any ingredient", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
            makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
            makeRecipe({ name: "Rice", ingredients: "rice, water" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        ingredients: ["tomato", "garlic"],
        match: "any",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Pasta");
      expect(text).toContain("Salad");
      expect(text).not.toContain("Rice");
    });

    it("D7.ingredient.3: mode defaults to all (explicit all mirrors SDK default)", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "HasBoth", ingredients: "tomato, garlic" }),
            makeRecipe({ name: "HasOne", ingredients: "tomato, onion" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        ingredients: ["tomato", "garlic"],
        match: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("HasBoth");
      expect(text).not.toContain("HasOne");
    });

    it("D7.ingredient.4: no matching recipes returns empty-result message", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ name: "Pasta", ingredients: "pasta, tomato" })],
        }),
      );

      const result = await callTool("search_recipes", {
        ingredients: ["sushi"],
        match: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });

    it("D7.ingredient.5: limit caps ingredient-only results", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: Array.from({ length: 25 }, (_, i) =>
            makeRecipe({ name: `Recipe ${String(i + 1)}`, ingredients: "tomato" }),
          ),
        }),
      );

      const result = await callTool("search_recipes", {
        ingredients: ["tomato"],
        match: "all",
        limit: 20,
      });
      const text = getText(result);
      const separators = (text.match(/^---$/gm) ?? []).length;

      expect(separators).toBe(19); // 20 results = 19 separators
    });
  });

  // ---------------------------------------------------------------------------
  // D7: time filtering on search_recipes
  // ---------------------------------------------------------------------------

  describe("D7: time filtering via search_recipes", () => {
    it("D7.time.1: maxTotal returns only recipes with totalTime <= constraint", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Quick", totalTime: "20 min" }),
            makeRecipe({ name: "Medium", totalTime: "45 min" }),
            makeRecipe({ name: "Slow", totalTime: "2 hours" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        maxTotal: "30 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Quick");
      expect(text).not.toContain("Medium");
      expect(text).not.toContain("Slow");
    });

    it("D7.time.2: maxPrep returns only recipes with prepTime <= constraint", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "QuickPrep", prepTime: "10 min" }),
            makeRecipe({ name: "LongPrep", prepTime: "1 hour" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        maxPrep: "15 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("QuickPrep");
      expect(text).not.toContain("LongPrep");
    });

    it("D7.time.3: maxCook returns only recipes with cookTime <= constraint", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "QuickCook", cookTime: "15 min" }),
            makeRecipe({ name: "SlowCook", cookTime: "3 hours" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        maxCook: "30 min",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("QuickCook");
      expect(text).not.toContain("SlowCook");
    });

    it("D7.time.4: time-only results ordered by total time ascending", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Slow", totalTime: "60 min" }),
            makeRecipe({ name: "Fast", totalTime: "10 min" }),
            makeRecipe({ name: "Medium", totalTime: "30 min" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        maxTotal: "2 hours",
        limit: 20,
      });
      const text = getText(result);

      const fastPos = text.indexOf("Fast");
      const mediumPos = text.indexOf("Medium");
      const slowPos = text.indexOf("Slow");

      expect(fastPos).toBeLessThan(mediumPos);
      expect(mediumPos).toBeLessThan(slowPos);
    });

    it("D7.time.5: limit applied post-store (at most limit results)", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: Array.from({ length: 10 }, (_, i) =>
            makeRecipe({ name: `Recipe ${String(i + 1)}`, totalTime: "20 min" }),
          ),
        }),
      );

      const result = await callTool("search_recipes", {
        maxTotal: "1 hour",
        limit: 3,
      });
      const text = getText(result);
      const separators = (text.match(/^---$/gm) ?? []).length;

      expect(separators).toBe(2); // 3 results = 2 separators
    });

    it("D7.time.6: no recipes match constraints returns empty-result message", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Slow", totalTime: "4 hours" })] }),
      );

      const result = await callTool("search_recipes", {
        maxTotal: "10 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });

    it("D7.time.7: invalid duration string returns user-friendly error message", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Quick", totalTime: "20 min" })] }),
      );

      const result = await callTool("search_recipes", {
        maxTotal: "not a time",
        limit: 20,
      });
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("invalid");
    });

    it("D7.time.8: a genuinely-unparseable-time recipe is kept but flagged 'Time unverified' (advisory)", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "CleanRecipe", totalTime: "20 min" }),
            makeRecipe({ name: "VagueRecipe", totalTime: "overnight" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", { maxTotal: "30 minutes", limit: 20 });
      const text = getText(result);

      // Lenient inclusion preserved: both are returned, the unparseable one not hidden.
      expect(text).toContain("CleanRecipe");
      expect(text).toContain("VagueRecipe");
      // Only the unparseable one carries the advisory flag.
      expect(text).toContain("Time unverified");
      expect(text).toContain("total time");
      expect((text.match(/Time unverified/g) ?? []).length).toBe(1);
    });

    it("D7.time.9: recipes whose times all parse carry no advisory flag", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "AllClean", totalTime: "20 min" })] }),
      );

      const result = await callTool("search_recipes", { maxTotal: "30 minutes", limit: 20 });
      const text = getText(result);

      expect(text).toContain("AllClean");
      expect(text).not.toContain("Time unverified");
    });

    it("D7.time.10: '+'-suffixed time ('5+ hours') now parses and is correctly excluded", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "QuickReal", totalTime: "20 min" }),
            makeRecipe({ name: "LongPlus", totalTime: "5+ hours" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", { maxTotal: "30 minutes", limit: 20 });
      const text = getText(result);

      expect(text).toContain("QuickReal");
      expect(text).not.toContain("LongPlus");
      expect(text).not.toContain("Time unverified");
    });
  });

  // ---------------------------------------------------------------------------
  // D7: combined criteria (AND-intersection)
  // ---------------------------------------------------------------------------

  describe("D7: combined criteria — AND-intersection", () => {
    it("D7.combined.1: query + ingredients AND-combine (recipe matching query but not ingredients is excluded)", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            // matches query "pasta" AND has garlic
            makeRecipe({ name: "Pasta Aglio", ingredients: "pasta, garlic, olive oil" }),
            // matches query "pasta" but LACKS garlic
            makeRecipe({ name: "Pasta Marinara", ingredients: "pasta, tomato" }),
            // has garlic but does NOT match query "pasta"
            makeRecipe({ name: "Garlic Bread", ingredients: "bread, garlic, butter" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        query: "pasta",
        ingredients: ["garlic"],
        match: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Pasta Aglio");
      expect(text).not.toContain("Pasta Marinara");
      expect(text).not.toContain("Garlic Bread");
    });

    it("D7.combined.2: query + time AND-combine (slow match excluded even if query matches)", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Quick Soup", totalTime: "20 min" }),
            makeRecipe({ name: "Slow Soup", totalTime: "3 hours" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        query: "soup",
        maxTotal: "30 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Quick Soup");
      expect(text).not.toContain("Slow Soup");
    });

    it("D7.combined.3: ingredients + time AND-combine correctly", async () => {
      const { server, callTool } = makeTestServer();
      registerSearchTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            // has chicken AND is quick → included
            makeRecipe({ name: "Quick Chicken", ingredients: "chicken, broth", totalTime: "20 min" }),
            // has chicken but slow → excluded by time
            makeRecipe({ name: "Slow Chicken", ingredients: "chicken, spices", totalTime: "2 hours" }),
            // quick but no chicken → excluded by ingredient
            makeRecipe({ name: "Quick Pasta", ingredients: "pasta, tomato", totalTime: "15 min" }),
          ],
        }),
      );

      const result = await callTool("search_recipes", {
        ingredients: ["chicken"],
        match: "all",
        maxTotal: "30 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Quick Chicken");
      expect(text).not.toContain("Slow Chicken");
      expect(text).not.toContain("Quick Pasta");
    });
  });

  // ---------------------------------------------------------------------------
  // D7: at-least-one-criterion rule
  // ---------------------------------------------------------------------------

  describe("D7: at-least-one-criterion validation", () => {
    it("D7.validation.1: all-empty input is rejected by schema safeParse", () => {
      const result = searchRecipesInputSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("D7.validation.2: empty query + no other criteria is rejected by schema safeParse", () => {
      const result = searchRecipesInputSchema.safeParse({ query: "" });
      expect(result.success).toBe(false);
    });

    it("D7.validation.3: query alone (non-empty) passes schema validation", () => {
      const result = searchRecipesInputSchema.safeParse({ query: "chicken" });
      expect(result.success).toBe(true);
    });

    it("D7.validation.4: ingredients alone passes schema validation", () => {
      const result = searchRecipesInputSchema.safeParse({ ingredients: ["tomato"] });
      expect(result.success).toBe(true);
    });

    it("D7.validation.5: maxTotal alone passes schema validation", () => {
      const result = searchRecipesInputSchema.safeParse({ maxTotal: "30 minutes" });
      expect(result.success).toBe(true);
    });
  });
});
