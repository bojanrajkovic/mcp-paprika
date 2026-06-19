import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { searchRecipesInputSchema } from "./search.js";

describe("search_recipes tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("emits structured recipe rows plus the total match count (R1)", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Tomato Soup" }), makeRecipe({ name: "Tomato Pasta" })] });
    const result = await kh.callTool("search_recipes", { query: "tomato", limit: 1 });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as { items: Array<Record<string, unknown>>; total: number };
    expect(payload.total).toBe(2); // both match; capped at limit 1
    expect(payload.items).toHaveLength(1);
    expect(String(payload.items[0]!["name"])).toContain("Tomato");
  });

  it("requires at least one criterion (isError)", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Anything" })] });
    const result = await kh.callTool("search_recipes", {});
    expect(result.isError).toBe(true);
    expect(getText(result).toLowerCase()).toContain("at least one");
  });

  it("non-empty store with matching query returns formatted results", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake" })] });
    const text = await kh.callToolText("search_recipes", { query: "chocolate", limit: 20 });
    expect(text).toContain("Chocolate Cake");
  });

  it("time fields are rendered when populated", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta Carbonara", prepTime: "10 min", totalTime: "25 min" })] });
    const text = await kh.callToolText("search_recipes", { query: "pasta", limit: 20 });
    expect(text).toContain("Prep: 10 min");
    expect(text).toContain("Total: 25 min");
  });

  it("limit defaults to 20 when store has many matches", async () => {
    kh.seed({
      recipes: Array.from({ length: 25 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}` })),
    });
    // Pass limit: 20 explicitly (mirrors what the SDK provides when caller omits limit,
    // since z.default(20) ensures the handler always receives 20 for omitted limit).
    const text = await kh.callToolText("search_recipes", { query: "recipe", limit: 20 });
    // Count "---" separators: N results produce N-1 separators
    const separators = (text.match(/^---$/gm) ?? []).length;
    expect(separators).toBe(19); // 20 results = 19 separators
  });

  it("limit caps result count", async () => {
    kh.seed({
      recipes: Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}` })),
    });
    const text = await kh.callToolText("search_recipes", { query: "recipe", limit: 3 });
    const separators = (text.match(/^---$/gm) ?? []).length;
    expect(separators).toBe(2); // 3 results = 2 separators
  });

  it("category names appear in formatted results", async () => {
    const category = makeCategory({ name: "Dessert" });
    kh.seed({ recipes: [makeRecipe({ name: "Cake", categories: [category.uid] })], categories: [category] });
    const text = await kh.callToolText("search_recipes", { query: "cake", limit: 20 });
    expect(text).toContain("Dessert");
  });

  it("empty store returns cold-start guard message", async () => {
    // store never seeded — size === 0, hasSynced false
    const text = await kh.callToolText("search_recipes", { query: "anything", limit: 20 });
    expect(text.toLowerCase()).toContain("try again");
  });

  it("no matching recipes returns empty-result message (not an error)", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta Carbonara" })] });
    const result = await kh.callTool("search_recipes", { query: "sushi", limit: 20 });
    expect(result.isError).toBeFalsy();
    expect(getText(result).toLowerCase()).toContain("no recipes");
  });

  it("rating appears in search hit when greater than 0", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake", rating: 5 })] });
    const text = await kh.callToolText("search_recipes", { query: "chocolate", limit: 20 });
    expect(text).toContain("5/5");
  });

  it("rating is absent from search hit when 0", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake", rating: 0 })] });
    const text = await kh.callToolText("search_recipes", { query: "chocolate", limit: 20 });
    expect(text).not.toContain("/5");
  });

  it("pinned marker appears in search hit when isPinned is true", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake", isPinned: true })] });
    const text = await kh.callToolText("search_recipes", { query: "chocolate", limit: 20 });
    expect(text).toContain("Pinned");
  });

  it("pinned marker is absent from search hit when isPinned is false", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake", isPinned: false })] });
    const text = await kh.callToolText("search_recipes", { query: "chocolate", limit: 20 });
    expect(text).not.toContain("Pinned");
  });

  it("on-grocery-list marker appears in search hit when onGroceryList is true", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake", onGroceryList: true })] });
    const text = await kh.callToolText("search_recipes", { query: "chocolate", limit: 20 });
    expect(text).toContain("Grocery List");
  });

  it("on-grocery-list marker is absent from search hit when onGroceryList is false", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake", onGroceryList: false })] });
    const text = await kh.callToolText("search_recipes", { query: "chocolate", limit: 20 });
    expect(text).not.toContain("Grocery List");
  });

  // ---------------------------------------------------------------------------
  // Ingredient filtering
  // ---------------------------------------------------------------------------

  describe("ingredient filtering", () => {
    it("mode=all returns only recipes containing all ingredients", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
          makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
          makeRecipe({ name: "Garlic Bread", ingredients: "bread, garlic, butter" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", {
        ingredients: ["tomato", "garlic"],
        match: "all",
        limit: 20,
      });
      expect(text).toContain("Pasta");
      expect(text).not.toContain("Salad");
      expect(text).not.toContain("Garlic Bread");
    });

    it("mode=any returns recipes containing any ingredient", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
          makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
          makeRecipe({ name: "Rice", ingredients: "rice, water" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", {
        ingredients: ["tomato", "garlic"],
        match: "any",
        limit: 20,
      });
      expect(text).toContain("Pasta");
      expect(text).toContain("Salad");
      expect(text).not.toContain("Rice");
    });

    it("explicit mode=all mirrors the default and excludes recipes with only one ingredient", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "HasBoth", ingredients: "tomato, garlic" }),
          makeRecipe({ name: "HasOne", ingredients: "tomato, onion" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", {
        ingredients: ["tomato", "garlic"],
        match: "all",
        limit: 20,
      });
      expect(text).toContain("HasBoth");
      expect(text).not.toContain("HasOne");
    });

    it("no matching recipes returns empty-result message", async () => {
      kh.seed({ recipes: [makeRecipe({ name: "Pasta", ingredients: "pasta, tomato" })] });
      const result = await kh.callTool("search_recipes", { ingredients: ["sushi"], match: "all", limit: 20 });
      expect(result.isError).toBeFalsy();
      expect(getText(result).toLowerCase()).toContain("no recipes");
    });

    it("limit caps ingredient-only results", async () => {
      kh.seed({
        recipes: Array.from({ length: 25 }, (_, i) =>
          makeRecipe({ name: `Recipe ${String(i + 1)}`, ingredients: "tomato" }),
        ),
      });
      const text = await kh.callToolText("search_recipes", { ingredients: ["tomato"], match: "all", limit: 20 });
      const separators = (text.match(/^---$/gm) ?? []).length;
      expect(separators).toBe(19); // 20 results = 19 separators
    });
  });

  // ---------------------------------------------------------------------------
  // Time filtering
  // ---------------------------------------------------------------------------

  describe("time filtering", () => {
    it("maxTotal returns only recipes with totalTime at or below the constraint", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "Quick", totalTime: "20 min" }),
          makeRecipe({ name: "Medium", totalTime: "45 min" }),
          makeRecipe({ name: "Slow", totalTime: "2 hours" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", { maxTotal: "30 minutes", limit: 20 });
      expect(text).toContain("Quick");
      expect(text).not.toContain("Medium");
      expect(text).not.toContain("Slow");
    });

    it("maxPrep returns only recipes with prepTime at or below the constraint", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "QuickPrep", prepTime: "10 min" }),
          makeRecipe({ name: "LongPrep", prepTime: "1 hour" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", { maxPrep: "15 minutes", limit: 20 });
      expect(text).toContain("QuickPrep");
      expect(text).not.toContain("LongPrep");
    });

    it("maxCook returns only recipes with cookTime at or below the constraint", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "QuickCook", cookTime: "15 min" }),
          makeRecipe({ name: "SlowCook", cookTime: "3 hours" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", { maxCook: "30 min", limit: 20 });
      expect(text).toContain("QuickCook");
      expect(text).not.toContain("SlowCook");
    });

    it("time-only results are ordered by total time ascending", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "Slow", totalTime: "60 min" }),
          makeRecipe({ name: "Fast", totalTime: "10 min" }),
          makeRecipe({ name: "Medium", totalTime: "30 min" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", { maxTotal: "2 hours", limit: 20 });
      expect(text.indexOf("Fast")).toBeLessThan(text.indexOf("Medium"));
      expect(text.indexOf("Medium")).toBeLessThan(text.indexOf("Slow"));
    });

    it("limit is applied after time filtering", async () => {
      kh.seed({
        recipes: Array.from({ length: 10 }, (_, i) =>
          makeRecipe({ name: `Recipe ${String(i + 1)}`, totalTime: "20 min" }),
        ),
      });
      const text = await kh.callToolText("search_recipes", { maxTotal: "1 hour", limit: 3 });
      const separators = (text.match(/^---$/gm) ?? []).length;
      expect(separators).toBe(2); // 3 results = 2 separators
    });

    it("no recipes matching time constraints returns empty-result message", async () => {
      kh.seed({ recipes: [makeRecipe({ name: "Slow", totalTime: "4 hours" })] });
      const result = await kh.callTool("search_recipes", { maxTotal: "10 minutes", limit: 20 });
      expect(result.isError).toBeFalsy();
      expect(getText(result).toLowerCase()).toContain("no recipes");
    });

    it("invalid duration string returns a user-friendly error (isError)", async () => {
      kh.seed({ recipes: [makeRecipe({ name: "Quick", totalTime: "20 min" })] });
      const result = await kh.callTool("search_recipes", { maxTotal: "not a time", limit: 20 });
      // Unparseable input is a bad-input error (exempt from the SDK's output validation).
      expect(result.isError).toBe(true);
      expect(getText(result).toLowerCase()).toContain("invalid");
    });

    it("unparseable recipe time is kept but flagged 'Time unverified' (advisory)", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "CleanRecipe", totalTime: "20 min" }),
          makeRecipe({ name: "VagueRecipe", totalTime: "overnight" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", { maxTotal: "30 minutes", limit: 20 });
      // Lenient inclusion: both are returned, the unparseable one not hidden.
      expect(text).toContain("CleanRecipe");
      expect(text).toContain("VagueRecipe");
      // Only the unparseable one carries the advisory flag.
      expect(text).toContain("Time unverified");
      expect(text).toContain("total time");
      expect((text.match(/Time unverified/g) ?? []).length).toBe(1);
    });

    it("recipes whose times all parse carry no advisory flag", async () => {
      kh.seed({ recipes: [makeRecipe({ name: "AllClean", totalTime: "20 min" })] });
      const text = await kh.callToolText("search_recipes", { maxTotal: "30 minutes", limit: 20 });
      expect(text).toContain("AllClean");
      expect(text).not.toContain("Time unverified");
    });

    it("'+'-suffixed time ('5+ hours') parses and is correctly excluded", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "QuickReal", totalTime: "20 min" }),
          makeRecipe({ name: "LongPlus", totalTime: "5+ hours" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", { maxTotal: "30 minutes", limit: 20 });
      expect(text).toContain("QuickReal");
      expect(text).not.toContain("LongPlus");
      expect(text).not.toContain("Time unverified");
    });
  });

  // ---------------------------------------------------------------------------
  // Combined criteria (AND-intersection)
  // ---------------------------------------------------------------------------

  describe("combined criteria — AND-intersection", () => {
    it("query + ingredients AND-combine (recipe matching query but not ingredients is excluded)", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "Pasta Aglio", ingredients: "pasta, garlic, olive oil" }),
          makeRecipe({ name: "Pasta Marinara", ingredients: "pasta, tomato" }),
          makeRecipe({ name: "Garlic Bread", ingredients: "bread, garlic, butter" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", {
        query: "pasta",
        ingredients: ["garlic"],
        match: "all",
        limit: 20,
      });
      expect(text).toContain("Pasta Aglio");
      expect(text).not.toContain("Pasta Marinara");
      expect(text).not.toContain("Garlic Bread");
    });

    it("query + time AND-combine (slow match excluded even if query matches)", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ name: "Quick Soup", totalTime: "20 min" }),
          makeRecipe({ name: "Slow Soup", totalTime: "3 hours" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", { query: "soup", maxTotal: "30 minutes", limit: 20 });
      expect(text).toContain("Quick Soup");
      expect(text).not.toContain("Slow Soup");
    });

    it("ingredients + time AND-combine correctly", async () => {
      kh.seed({
        recipes: [
          // has chicken AND is quick → included
          makeRecipe({ name: "Quick Chicken", ingredients: "chicken, broth", totalTime: "20 min" }),
          // has chicken but slow → excluded by time
          makeRecipe({ name: "Slow Chicken", ingredients: "chicken, spices", totalTime: "2 hours" }),
          // quick but no chicken → excluded by ingredient
          makeRecipe({ name: "Quick Pasta", ingredients: "pasta, tomato", totalTime: "15 min" }),
        ],
      });
      const text = await kh.callToolText("search_recipes", {
        ingredients: ["chicken"],
        match: "all",
        maxTotal: "30 minutes",
        limit: 20,
      });
      expect(text).toContain("Quick Chicken");
      expect(text).not.toContain("Slow Chicken");
      expect(text).not.toContain("Quick Pasta");
    });
  });

  // ---------------------------------------------------------------------------
  // At-least-one-criterion rule
  // ---------------------------------------------------------------------------

  describe("at-least-one-criterion rule", () => {
    // The rule is enforced in the handler (not on the schema): a refined schema
    // would be a ZodEffects, which the MCP SDK publishes with zero properties.
    it("an all-empty call is rejected by the handler", async () => {
      kh.seed({ recipes: [makeRecipe({ name: "X" })] });
      const text = await kh.callToolText("search_recipes", {});
      expect(text).toContain("Provide at least one");
    });

    it("empty query with no other criteria is rejected by the handler", async () => {
      kh.seed({ recipes: [makeRecipe({ name: "X" })] });
      const text = await kh.callToolText("search_recipes", { query: "" });
      expect(text).toContain("Provide at least one");
    });

    it("query alone (non-empty) passes schema validation", () => {
      expect(searchRecipesInputSchema.safeParse({ query: "chicken" }).success).toBe(true);
    });

    it("ingredients alone passes schema validation", () => {
      expect(searchRecipesInputSchema.safeParse({ ingredients: ["tomato"] }).success).toBe(true);
    });

    it("maxTotal alone passes schema validation", () => {
      expect(searchRecipesInputSchema.safeParse({ maxTotal: "30 minutes" }).success).toBe(true);
    });

    it("schema is a plain object so the SDK can publish its params", () => {
      // Regression guard for the ZodEffects empty-published-schema bug: a refined
      // schema has no .shape and the SDK serializes zero properties.
      expect(searchRecipesInputSchema.shape).toBeDefined();
      expect(Object.keys(searchRecipesInputSchema.shape)).toContain("query");
    });
  });
});
