import { describe, expect, it } from "vitest";

import type { RecipeUid } from "./ids.js";

import { makeCategory, makeRecipe } from "../../../test/domains/recipe/__fixtures__/recipes.js";
import { recipePhotoResourceUri, recipeToReadStructured, recipeToRow, resolveCategoryRefs } from "./recipe-helpers.js";

describe("shared helper functions", () => {
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
