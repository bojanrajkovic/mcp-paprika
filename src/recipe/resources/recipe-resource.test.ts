import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CategoryUid, RecipeUid } from "../../ids.js";
import type { RecipeSelf } from "../module.js";

import { makeCategory, makeRecipe } from "../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";

describe("recipe MCP resource", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  describe("list", () => {
    it("returns each non-trashed recipe with uri, name, and mimeType", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Pasta" }),
          makeRecipe({ uid: "recipe-2" as RecipeUid, name: "Salad" }),
        ],
      });

      const result = (await kh.callResourceList("recipes")) as {
        resources: Array<{ uri: string; name: string; mimeType: string }>;
      };

      expect(result.resources).toHaveLength(2);
      expect(result.resources[0]).toEqual({
        uri: "paprika://recipe/recipe-1",
        name: "Pasta",
        mimeType: "text/markdown",
      });
      expect(result.resources[1]).toEqual({
        uri: "paprika://recipe/recipe-2",
        name: "Salad",
        mimeType: "text/markdown",
      });
    });

    it("returns an empty array for an empty store", async () => {
      kh.seed({ recipes: [] });
      expect(await kh.callResourceList("recipes")).toEqual({ resources: [] });
    });

    it("excludes trashed recipes", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Good Recipe" }),
          makeRecipe({ uid: "recipe-2" as RecipeUid, name: "Trashed Recipe", inTrash: true }),
        ],
      });

      const result = (await kh.callResourceList("recipes")) as { resources: Array<{ uri: string; name: string }> };
      expect(result.resources).toHaveLength(1);
      expect(result.resources[0]?.name).toBe("Good Recipe");
    });
  });

  describe("read", () => {
    it("prepends the URI header and renders the UID exactly once", async () => {
      kh.seed({
        recipes: [
          makeRecipe({
            uid: "test-recipe" as RecipeUid,
            name: "Test Recipe",
            ingredients: "flour, sugar",
            directions: "Mix and bake",
          }),
        ],
      });

      const result = (await kh.callResource("recipes", "test-recipe")) as { contents: Array<{ text: string }> };
      const text = result.contents[0]?.text ?? "";
      // URI header leads; the UID is rendered once by recipeToMarkdown in the body (#195).
      expect(text).toMatch(/^\*\*URI:\*\*\s`paprika:\/\/recipe\/test-recipe`/);
      expect(text).toContain("**UID:** `test-recipe`");
      expect(text.match(/\*\*UID:\*\*/g)).toHaveLength(1);
    });

    it("includes Last synced when the store has been synced", async () => {
      kh.seed({ recipes: [makeRecipe({ uid: "test-recipe" as RecipeUid, name: "Test" })] });
      (kh.self() as RecipeSelf).recipe.store.setLastSyncedAt(new Date("2026-05-24T12:00:00Z"));

      const result = (await kh.callResource("recipes", "test-recipe")) as { contents: Array<{ text: string }> };
      expect(result.contents[0]?.text).toContain("**Last synced:** 2026-05-24T12:00:00.000Z");
    });

    it("omits Last synced when the store has never been synced", async () => {
      kh.seed({ recipes: [makeRecipe({ uid: "test-recipe" as RecipeUid, name: "Test" })] });
      const result = (await kh.callResource("recipes", "test-recipe")) as { contents: Array<{ text: string }> };
      expect(result.contents[0]?.text).not.toContain("**Last synced:**");
    });

    it("includes Photo when the recipe has an image URL", async () => {
      kh.seed({
        recipes: [
          makeRecipe({ uid: "test-recipe" as RecipeUid, name: "Test", imageUrl: "https://example.com/photo.jpg" }),
        ],
      });
      const result = (await kh.callResource("recipes", "test-recipe")) as { contents: Array<{ text: string }> };
      expect(result.contents[0]?.text).toContain("**Photo:** https://example.com/photo.jpg");
    });

    it("omits Photo when the recipe has no image URL", async () => {
      kh.seed({ recipes: [makeRecipe({ uid: "test-recipe" as RecipeUid, name: "Test", imageUrl: "" })] });
      const result = (await kh.callResource("recipes", "test-recipe")) as { contents: Array<{ text: string }> };
      expect(result.contents[0]?.text).not.toContain("**Photo:**");
    });

    it("resolves category UIDs to display names", async () => {
      kh.seed({
        recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Cake", categories: ["cat-1" as CategoryUid] })],
        categories: [makeCategory({ uid: "cat-1" as CategoryUid, name: "Desserts" })],
      });
      const result = (await kh.callResource("recipes", "recipe-1")) as { contents: Array<{ text: string }> };
      expect(result.contents[0]?.text).toContain("**Categories:** Desserts");
    });

    it("returns text/markdown mimeType and the resource uri", async () => {
      kh.seed({
        recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Test", ingredients: "test", directions: "test" })],
      });
      const result = (await kh.callResource("recipes", "recipe-1")) as {
        contents: Array<{ uri: string; mimeType: string; text: string }>;
      };
      expect(result.contents[0]).toMatchObject({ mimeType: "text/markdown", uri: "paprika://recipe/recipe-1" });
      expect(result.contents[0]?.text).toBeDefined();
    });

    it("throws for a nonexistent UID", async () => {
      kh.seed({ recipes: [] });
      await expect(kh.callResource("recipes", "nonexistent-uid")).rejects.toThrow();
    });
  });
});
