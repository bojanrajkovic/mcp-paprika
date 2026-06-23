import { describe, expect, it } from "vitest";

import type { RecipeUid } from "./ids.js";

import { makeCategory, makeRecipe } from "../../../test/domains/recipe/__fixtures__/recipes.js";
import {
  recipeMetadataLines,
  recipePhotoResourceUri,
  recipeToMarkdown,
  recipeToReadStructured,
  recipeToRow,
  resolveCategoryRefs,
} from "./recipe-markdown.js";

describe("shared helper functions", () => {
  describe("recipeToMarkdown renders a recipe as human-readable markdown", () => {
    it("output starts with # {recipe.name}", () => {
      const recipe = makeRecipe({ name: "Chocolate Cake" });
      const output = recipeToMarkdown(recipe, []);
      expect(output.startsWith("# Chocolate Cake")).toBe(true);
    });

    it("output always contains ## Ingredients section", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Ingredients");
    });

    it("output always contains ## Directions section", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Directions");
    });

    it("description field is included when non-empty", () => {
      const recipe = makeRecipe({ description: "Tasty cake with frosting" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("Tasty cake with frosting");
    });

    it("description field is omitted when null", () => {
      const recipe = makeRecipe({ description: null });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("## Description");
    });

    it("non-empty categoryNames appear in output", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, ["Dessert", "Chocolate"]);
      expect(output).toContain("Dessert");
      expect(output).toContain("Chocolate");
    });

    it("empty categoryNames array results in no categories section", () => {
      const recipe = makeRecipe();
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Categories:**");
    });

    it("notes field is included when non-empty", () => {
      const recipe = makeRecipe({ notes: "My personal note" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Notes");
      expect(output).toContain("My personal note");
    });

    it("notes field is omitted when null", () => {
      const recipe = makeRecipe({ notes: null });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("## Notes");
    });

    it("nutritionalInfo field is included when non-empty", () => {
      const recipe = makeRecipe({ nutritionalInfo: "200 cal" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("## Nutritional Info");
      expect(output).toContain("200 cal");
    });

    it("nutritionalInfo field is omitted when null", () => {
      const recipe = makeRecipe({ nutritionalInfo: null });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("## Nutritional Info");
    });

    it("source with sourceUrl is rendered as markdown link", () => {
      const recipe = makeRecipe({
        source: "Food Network",
        sourceUrl: "https://example.com",
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("[Food Network](https://example.com)");
    });

    it("source without sourceUrl is plain text", () => {
      const recipe = makeRecipe({
        source: "Food Network",
        sourceUrl: null,
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Source:** Food Network");
      expect(output).not.toContain("[Food Network]");
    });

    it("sourceUrl without source is plain link", () => {
      const recipe = makeRecipe({
        source: null,
        sourceUrl: "https://example.com",
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Source:** https://example.com");
    });

    it("when source and sourceUrl are both null/empty, no source section appears", () => {
      const recipe = makeRecipe({
        source: null,
        sourceUrl: null,
      });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Source:**");
    });

    it("created field always appears in output", () => {
      const recipe = makeRecipe({ created: "2026-03-15T10:00:00Z" });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Created:**");
      expect(output).toContain("2026-03-15T10:00:00Z");
    });

    it("rating appears as X/5 when > 0", () => {
      const recipe = makeRecipe({ rating: 4 });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Rating:** 4/5");
    });

    it("rating section omitted when rating is 0", () => {
      const recipe = makeRecipe({ rating: 0 });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Rating:**");
    });

    it("isPinned appears when true", () => {
      const recipe = makeRecipe({ isPinned: true });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**Pinned:** Yes");
    });

    it("isPinned section omitted when false", () => {
      const recipe = makeRecipe({ isPinned: false });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**Pinned:**");
    });

    it("onGroceryList appears when true", () => {
      const recipe = makeRecipe({ onGroceryList: true });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**On Grocery List:** Yes");
    });

    it("onGroceryList section omitted when false", () => {
      const recipe = makeRecipe({ onGroceryList: false });
      const output = recipeToMarkdown(recipe, []);
      expect(output).not.toContain("**On Grocery List:**");
    });

    it("onFavorites appears when true", () => {
      const recipe = makeRecipe({ onFavorites: true });
      const output = recipeToMarkdown(recipe, []);
      expect(output).toContain("**On Favorites:** Yes");
    });

    it("onFavorites section omitted when false", () => {
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

  describe("resolveCategoryRefs", () => {
    it("exact name match returns the category's UID in uids and empty unknown array", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], ["Desserts"]);
      expect(result.uids).toHaveLength(1);
      expect(result.uids[0]).toBe(cat.uid);
      expect(result.unknown).toEqual([]);
    });

    it("case-insensitive match (desserts matches Desserts) returns the UID, not in unknown", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], ["desserts"]);
      expect(result.uids).toHaveLength(1);
      expect(result.uids[0]).toBe(cat.uid);
      expect(result.unknown).toEqual([]);
    });

    it("unrecognized name appears in unknown, not in uids", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], ["Breakfast"]);
      expect(result.uids).toEqual([]);
      expect(result.unknown).toEqual(["Breakfast"]);
    });

    it("mix of known and unknown — known go to uids, unknown go to unknown, both in input order", () => {
      const cat1 = makeCategory({ name: "Desserts" });
      const cat2 = makeCategory({ name: "Breakfast" });
      const result = resolveCategoryRefs([cat1, cat2], ["Breakfast", "Unknown", "Desserts", "Other"]);
      expect(result.uids).toEqual([cat2.uid, cat1.uid]);
      expect(result.unknown).toEqual(["Unknown", "Other"]);
    });

    it("empty names array returns uids: [], unknown: []", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], []);
      expect(result.uids).toEqual([]);
      expect(result.unknown).toEqual([]);
    });

    it("empty categories array with non-empty names returns all names in unknown", () => {
      const result = resolveCategoryRefs([], ["Desserts", "Breakfast"]);
      expect(result.uids).toEqual([]);
      expect(result.unknown).toEqual(["Desserts", "Breakfast"]);
    });

    it("a ref that exactly matches a known UID resolves UID-first", () => {
      const cat = makeCategory({ name: "Desserts" });
      const result = resolveCategoryRefs([cat], [cat.uid]);
      expect(result.uids).toEqual([cat.uid]);
      expect(result.unknown).toEqual([]);
    });

    it("UID and name refs can be mixed in one call", () => {
      const cat1 = makeCategory({ name: "Desserts" });
      const cat2 = makeCategory({ name: "Breakfast" });
      const result = resolveCategoryRefs([cat1, cat2], [cat1.uid, "Breakfast", "Unknown"]);
      expect(result.uids).toEqual([cat1.uid, cat2.uid]);
      expect(result.unknown).toEqual(["Unknown"]);
    });
  });

  describe("recipePhotoResourceUri", () => {
    it("returns the photo resource URI for an uploaded photo (photoLarge set)", () => {
      const recipe = makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "photo-a.jpg", imageUrl: "" });
      expect(recipePhotoResourceUri(recipe)).toBe("ui://recipe/r1/photo");
    });

    it("returns the URI for a web-imported recipe (imageUrl only)", () => {
      const recipe = makeRecipe({ uid: "r2" as RecipeUid, photoLarge: null, imageUrl: "https://x/y.jpg" });
      expect(recipePhotoResourceUri(recipe)).toBe("ui://recipe/r2/photo");
    });

    it("returns null when the recipe has no photo of any kind", () => {
      const recipe = makeRecipe({
        uid: "r3" as RecipeUid,
        photo: null,
        photoLarge: null,
        imageUrl: "",
        photoUrl: null,
      });
      expect(recipePhotoResourceUri(recipe)).toBeNull();
    });

    it("returns null when only the thumbnail `photo` is set (resolver can't serve a bare thumbnail)", () => {
      const recipe = makeRecipe({
        uid: "r4" as RecipeUid,
        photo: "thumb.jpg",
        photoLarge: null,
        imageUrl: "",
        photoUrl: null,
      });
      expect(recipePhotoResourceUri(recipe)).toBeNull();
    });

    it("is surfaced on the browse row and the single-recipe read structured output", () => {
      const withPhoto = makeRecipe({ uid: "r1" as RecipeUid, photoLarge: "photo-a.jpg", imageUrl: "" });
      const without = makeRecipe({
        uid: "r3" as RecipeUid,
        photo: null,
        photoLarge: null,
        imageUrl: "",
        photoUrl: null,
      });
      expect(recipeToRow(withPhoto, []).photoResourceUri).toBe("ui://recipe/r1/photo");
      expect(recipeToRow(without, []).photoResourceUri).toBeNull();
      expect(recipeToReadStructured(withPhoto, []).photoResourceUri).toBe("ui://recipe/r1/photo");
      expect(recipeToReadStructured(without, []).photoResourceUri).toBeNull();
    });
  });
});
