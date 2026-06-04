import { describe, expect, it } from "vitest";

import type { Recipe } from "../domains/recipe/types.js";

import { RECIPE_HASH_FIXTURES } from "../../test/paprika/__fixtures__/recipe-hashes.js";
import { RecipeStoredSchema } from "../domains/recipe/types.js";
import { computeRecipeHash } from "./recipe-hash.js";

const parse = (raw: Record<string, unknown>): Recipe => RecipeStoredSchema.parse(raw);

describe("computeRecipeHash", () => {
  // Each fixture's expectedHash is the authoritative output of the shipped
  // Paprika.framework's Recipe.hashValues + SHA-256, captured over an in-memory
  // Core Data recipe (#167). Matching all of them pins the NSJSON / slash-escape /
  // category-sort / empty-vs-null replication to real framework behavior.
  describe("framework ground-truth parity", () => {
    for (const fixture of RECIPE_HASH_FIXTURES) {
      it(`reproduces the framework hash for "${fixture.name}"`, () => {
        expect(computeRecipeHash(parse(fixture.recipe))).toBe(fixture.expectedHash);
      });
    }
  });

  const base = (): Recipe =>
    parse({
      uid: "RECIPE-UID",
      hash: "",
      name: "Test",
      categories: [],
      ingredients: "x",
      directions: "y",
      description: null,
      notes: null,
      prepTime: null,
      cookTime: null,
      totalTime: null,
      servings: null,
      difficulty: null,
      rating: 0,
      created: "2024-03-14 05:26:53",
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
    });

  it("is a 64-char uppercase hex digest", () => {
    expect(computeRecipeHash(base())).toMatch(/^[0-9A-F]{64}$/);
  });

  it("ignores the recipe's own hash field (blanked before hashing)", () => {
    const a = computeRecipeHash({ ...base(), hash: "" });
    const b = computeRecipeHash({ ...base(), hash: "DEADBEEF".repeat(8) });
    expect(a).toBe(b);
  });

  it("is independent of category insertion order (canonicalized by sort)", () => {
    const cats = ["F3830F75-CAT", "81ED2F6A-CAT", "8adefad1-cat", "Zebra-CAT", "apple-cat"];
    const forward = computeRecipeHash(parse({ ...base(), categories: cats }));
    const reversed = computeRecipeHash(parse({ ...base(), categories: [...cats].reverse() }));
    expect(forward).toBe(reversed);
  });

  it("is trash-independent (inTrash / deleted do not affect the hash)", () => {
    const live = computeRecipeHash(base());
    const trashed = computeRecipeHash({ ...base(), inTrash: true });
    const deleted = computeRecipeHash({ ...base(), inTrash: true, deleted: true });
    expect(trashed).toBe(live);
    expect(deleted).toBe(live);
  });

  it("distinguishes null from empty-string for nullable fields (no coercion)", () => {
    const nullScale = computeRecipeHash({ ...base(), scale: null });
    const emptyScale = computeRecipeHash({ ...base(), scale: "" });
    expect(nullScale).not.toBe(emptyScale);
  });

  it("changes when a hashed content field changes", () => {
    expect(computeRecipeHash(base())).not.toBe(computeRecipeHash({ ...base(), name: "Different" }));
  });
});
