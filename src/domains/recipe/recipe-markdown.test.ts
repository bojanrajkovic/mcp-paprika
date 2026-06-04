import { describe, expect, it } from "vitest";

import { makeCategory, makeRecipe } from "../../../test/cache/__fixtures__/recipes.js";
import { recipeMetadataLines, recipeToMarkdown, resolveCategoryRefs } from "./recipe-markdown.js";

describe("p2-u02-shared-helpers: shared helper functions", () => {
  describe("p2-u02-shared-helpers.AC3: recipeToMarkdown renders a recipe as human-readable markdown", () => {
    it("p2-u02-shared-helpers.AC3.1: output starts with # {recipe.name}", () => {
      const recipe = makeRecipe({ name: "Chocolate Cake" });
      const output = recipeToMarkdown(recipe, []);
      expect(output.startsWith("# Chocolate Cake")).toBe(true);
    });

    it("p2-u02-shared-helpers.AC3.2: output always contains ## Ingredients section", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Ingredients");
    });

    it("p2-u02-shared-helpers.AC3.3: output always contains ## Directions section", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Directions");
    });

    it("p2-u02-shared-helpers.AC3.4a: description field is included when non-empty", () => {
      const recipe = makeRecipe({ description: "Tasty cake with frosting" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("Tasty cake with frosting");
    });

    it("p2-u02-shared-helpers.AC3.4b: description field is omitted when null", () => {
      const recipe = makeRecipe({ description: null });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("## Description");
    });

    it("p2-u02-shared-helpers.AC3.5a: non-empty categoryNames appear in output", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, ["Dessert", "Chocolate"]);
      expect(output).toContain("Dessert");
      expect(output).toContain("Chocolate");
    });

    it("p2-u02-shared-helpers.AC3.6: empty categoryNames array results in no categories section", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Categories:**");
    });

    it("p2-u02-shared-helpers.AC3.4c: notes field is included when non-empty", () => {
      const recipe = makeRecipe({ notes: "My personal note" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Notes");
      expect(output).toContain("My personal note");
    });

    it("p2-u02-shared-helpers.AC3.4d: notes field is omitted when null", () => {
      const recipe = makeRecipe({ notes: null });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("## Notes");
    });

    it("p2-u02-shared-helpers.AC3.4e: nutritionalInfo field is included when non-empty", () => {
      const recipe = makeRecipe({ nutritionalInfo: "200 cal" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Nutritional Info");
      expect(output).toContain("200 cal");
    });

    it("p2-u02-shared-helpers.AC3.4f: nutritionalInfo field is omitted when null", () => {
      const recipe = makeRecipe({ nutritionalInfo: null });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("## Nutritional Info");
    });

    it("p2-u02-shared-helpers.AC3.4g: source with sourceUrl is rendered as markdown link", () => {
      const recipe = makeRecipe({
        source: "Food Network",
        sourceUrl: "https://example.com",
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("[Food Network](https://example.com)");
    });

    it("p2-u02-shared-helpers.AC3.4h: source without sourceUrl is plain text", () => {
      const recipe = makeRecipe({
        source: "Food Network",
        sourceUrl: null,
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Source:** Food Network");
      expect(output).not.toContain("[Food Network]");
    });

    it("p2-u02-shared-helpers.AC3.4i: sourceUrl without source is plain link", () => {
      const recipe = makeRecipe({
        source: null,
        sourceUrl: "https://example.com",
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Source:** https://example.com");
    });

    it("p2-u02-shared-helpers.AC3.4j: when source and sourceUrl are both null/empty, no source section appears", () => {
      const recipe = makeRecipe({
        source: null,
        sourceUrl: null,
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Source:**");
    });

    it("p2-u02-shared-helpers.AC3.4k: created field always appears in output", () => {
      const recipe = makeRecipe({ created: "2026-03-15T10:00:00Z" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Created:**");
      expect(output).toContain("2026-03-15T10:00:00Z");
    });

    it("p2-u02-shared-helpers.AC3.4l-pos: rating appears as X/5 when > 0", () => {
      const recipe = makeRecipe({ rating: 4 });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Rating:** 4/5");
    });

    it("p2-u02-shared-helpers.AC3.4l-neg: rating section omitted when rating is 0", () => {
      const recipe = makeRecipe({ rating: 0 });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Rating:**");
    });

    it("p2-u02-shared-helpers.AC3.4m-pos: isPinned appears when true", () => {
      const recipe = makeRecipe({ isPinned: true });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Pinned:** Yes");
    });

    it("p2-u02-shared-helpers.AC3.4m-neg: isPinned section omitted when false", () => {
      const recipe = makeRecipe({ isPinned: false });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Pinned:**");
    });

    it("p2-u02-shared-helpers.AC3.4n-pos: onGroceryList appears when true", () => {
      const recipe = makeRecipe({ onGroceryList: true });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**On Grocery List:** Yes");
    });

    it("p2-u02-shared-helpers.AC3.4n-neg: onGroceryList section omitted when false", () => {
      const recipe = makeRecipe({ onGroceryList: false });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**On Grocery List:**");
    });

    it("p2-u02-shared-helpers.AC3.4o-pos: onFavorites appears when true", () => {
      const recipe = makeRecipe({ onFavorites: true });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**On Favorites:** Yes");
    });

    it("p2-u02-shared-helpers.AC3.4o-neg: onFavorites section omitted when false", () => {
      const recipe = makeRecipe({ onFavorites: false });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**On Favorites:**");
    });
  });

  describe("lastCookedAt parameter", () => {
    it("recipeToMarkdown includes Last Cooked when provided", () => {
      const recipe = makeRecipe({ name: "Test" });
      const output = recipeToMarkdown(recipe, [], "2026-05-20 00:00:00");
      expect(output).toContain("**Last Cooked:** 2026-05-20");
    });

    it("recipeToMarkdown omits Last Cooked when null", () => {
      const recipe = makeRecipe({ name: "Test" });
      const output = recipeToMarkdown(recipe, [], null);
      expect(output).not.toContain("**Last Cooked:**");
    });

    it("recipeToMarkdown omits Last Cooked when omitted", () => {
      const recipe = makeRecipe({ name: "Test" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Last Cooked:**");
    });

    it("recipeMetadataLines includes Last Cooked when provided", () => {
      const recipe = makeRecipe({ rating: 0 });
      const lines = recipeMetadataLines(recipe, "2026-03-15 00:00:00");
      expect(lines).toContain("**Last Cooked:** 2026-03-15");
    });

    it("recipeMetadataLines omits Last Cooked when null", () => {
      const recipe = makeRecipe({ rating: 0 });
      const lines = recipeMetadataLines(recipe, null);
      expect(lines.some((l) => l.includes("Last Cooked"))).toBe(false);
    });
  });

  describe("p2-recipe-crud.AC-helpers: resolveCategoryRefs", () => {
    it("p2-recipe-crud.AC-helpers.1: exact name match returns the category's UID in uids and empty unknown array", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], ["Desserts"]);
      expect(result.uids).toHaveLength(1);
      expect(result.uids[0]).toBe(cat.uid);
      expect(result.unknown).toEqual([]);
    });

    it("p2-recipe-crud.AC-helpers.2: case-insensitive match (desserts matches Desserts) returns the UID, not in unknown", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], ["desserts"]);
      expect(result.uids).toHaveLength(1);
      expect(result.uids[0]).toBe(cat.uid);
      expect(result.unknown).toEqual([]);
    });

    it("p2-recipe-crud.AC-helpers.3: unrecognized name appears in unknown, not in uids", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], ["Breakfast"]);
      expect(result.uids).toEqual([]);
      expect(result.unknown).toEqual(["Breakfast"]);
    });

    it("p2-recipe-crud.AC-helpers.4: mix of known and unknown — known go to uids, unknown go to unknown, both in input order", () => {
      const cat1 = makeCategory({ name: "Desserts" });
      const cat2 = makeCategory({ name: "Breakfast" });
      const result = resolveCategoryRefs([cat1, cat2], ["Breakfast", "Unknown", "Desserts", "Other"]);
      expect(result.uids).toEqual([cat2.uid, cat1.uid]);
      expect(result.unknown).toEqual(["Unknown", "Other"]);
    });

    it("p2-recipe-crud.AC-helpers.5: empty names array returns uids: [], unknown: []", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], []);
      expect(result.uids).toEqual([]);
      expect(result.unknown).toEqual([]);
    });

    it("p2-recipe-crud.AC-helpers.6: empty all categories array with non-empty names returns all names in unknown", () => {
      const result = resolveCategoryRefs([], ["Desserts", "Breakfast"]);
      expect(result.uids).toEqual([]);
      expect(result.unknown).toEqual(["Desserts", "Breakfast"]);
    });

    it("p2-recipe-crud.AC-helpers.7: a ref that exactly matches a known UID resolves UID-first", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], [cat.uid]);
      expect(result.uids).toEqual([cat.uid]);
      expect(result.unknown).toEqual([]);
    });

    it("p2-recipe-crud.AC-helpers.8: UID and name refs can be mixed in one call", () => {
      const cat1 = makeCategory({ name: "Desserts" });
      const cat2 = makeCategory({ name: "Breakfast" });
      const result = resolveCategoryRefs([cat1, cat2], [cat1.uid, "Breakfast", "Unknown"]);
      expect(result.uids).toEqual([cat1.uid, cat2.uid]);
      expect(result.unknown).toEqual(["Unknown"]);
    });
  });
});
