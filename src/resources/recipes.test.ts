import { describe, expect, it } from "vitest";

import type { CategoryUid, RecipeUid } from "../ids.js";

import { makeCategory, makeRecipe } from "../cache/__fixtures__/recipes.js";
import { RecipeStore } from "../recipe/store.js";
import { makeCtx, makeTestServer, seed } from "../tools/tool-test-utils.js";
import { registerRecipeResources } from "./recipes.js";

describe("p2-u10-resource-reg: MCP Recipe Resources", () => {
  describe("p2-u10-resource-reg.AC1: Recipe list is accessible as MCP resources", () => {
    describe("p2-u10-resource-reg.AC1.1: List handler returns all non-trashed recipes with correct metadata", () => {
      it("returns recipes with uri, name, and mimeType for each", async () => {
        const { server, callResourceList } = makeTestServer();

        const recipe1 = makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Pasta" });
        const recipe2 = makeRecipe({ uid: "recipe-2" as RecipeUid, name: "Salad" });
        const ctx = seed(makeCtx(new RecipeStore(), server), {
          recipes: [recipe1, recipe2],
        });
        registerRecipeResources(server, ctx);

        const result = (await callResourceList("recipes")) as {
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
    });

    describe("p2-u10-resource-reg.AC1.2: List handler returns empty array when store is empty", () => {
      it("returns { resources: [] } for empty store with no error", async () => {
        const { server, callResourceList } = makeTestServer();
        const ctx = seed(makeCtx(new RecipeStore(), server), { recipes: [] });
        registerRecipeResources(server, ctx);

        const result = (await callResourceList("recipes")) as { resources: Array<unknown> };

        expect(result).toEqual({ resources: [] });
      });
    });

    describe("p2-u10-resource-reg.AC1.3: Trashed recipes are excluded from the list", () => {
      it("excludes recipes with inTrash: true from results", async () => {
        const { server, callResourceList } = makeTestServer();

        const nonTrashed = makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Good Recipe" });
        const trashed = makeRecipe({ uid: "recipe-2" as RecipeUid, name: "Trashed Recipe", inTrash: true });
        const ctx = seed(makeCtx(new RecipeStore(), server), {
          recipes: [nonTrashed, trashed],
        });
        registerRecipeResources(server, ctx);

        const result = (await callResourceList("recipes")) as {
          resources: Array<{ uri: string; name: string }>;
        };

        expect(result.resources).toHaveLength(1);
        expect(result.resources[0]?.name).toBe("Good Recipe");
      });
    });
  });

  describe("p2-u10-resource-reg.AC2: Individual recipes are readable as MCP resources", () => {
    describe("p2-u10-resource-reg.AC2.1: Read handler returns content with metadata header", () => {
      it("prepends UID and URI header lines to recipe markdown", async () => {
        const { server, callResource } = makeTestServer();

        const recipe = makeRecipe({
          uid: "test-recipe" as RecipeUid,
          name: "Test Recipe",
          ingredients: "flour, sugar",
          directions: "Mix and bake",
        });
        const ctx = seed(makeCtx(new RecipeStore(), server), { recipes: [recipe] });
        registerRecipeResources(server, ctx);

        const result = (await callResource("recipes", "test-recipe")) as {
          contents: Array<{ text: string }>;
        };

        const text = result.contents[0]?.text ?? "";
        // The URI header leads; the UID is rendered once, by recipeToMarkdown in
        // the body (no longer duplicated in the resource header — #195).
        expect(text).toMatch(/^\*\*URI:\*\*\s`paprika:\/\/recipe\/test-recipe`/);
        expect(text).toContain("**UID:** `test-recipe`");
        // exactly one UID line (no duplication)
        expect(text.match(/\*\*UID:\*\*/g)).toHaveLength(1);
      });

      it("includes Last synced when store has been synced", async () => {
        const { server, callResource } = makeTestServer();

        const recipe = makeRecipe({ uid: "test-recipe" as RecipeUid, name: "Test" });
        const store = new RecipeStore();
        const ctx = seed(makeCtx(store, server), { recipes: [recipe] });
        store.setLastSyncedAt(new Date("2026-05-24T12:00:00Z"));
        registerRecipeResources(server, ctx);

        const result = (await callResource("recipes", "test-recipe")) as {
          contents: Array<{ text: string }>;
        };

        expect(result.contents[0]?.text).toContain("**Last synced:** 2026-05-24T12:00:00.000Z");
      });

      it("omits Last synced when store has never been synced", async () => {
        const { server, callResource } = makeTestServer();

        const recipe = makeRecipe({ uid: "test-recipe" as RecipeUid, name: "Test" });
        const ctx = seed(makeCtx(new RecipeStore(), server), { recipes: [recipe] });
        registerRecipeResources(server, ctx);

        const result = (await callResource("recipes", "test-recipe")) as {
          contents: Array<{ text: string }>;
        };

        expect(result.contents[0]?.text).not.toContain("**Last synced:**");
      });

      it("includes Photo when recipe has an image URL", async () => {
        const { server, callResource } = makeTestServer();

        const recipe = makeRecipe({
          uid: "test-recipe" as RecipeUid,
          name: "Test",
          imageUrl: "https://example.com/photo.jpg",
        });
        const ctx = seed(makeCtx(new RecipeStore(), server), { recipes: [recipe] });
        registerRecipeResources(server, ctx);

        const result = (await callResource("recipes", "test-recipe")) as {
          contents: Array<{ text: string }>;
        };

        expect(result.contents[0]?.text).toContain("**Photo:** https://example.com/photo.jpg");
      });

      it("omits Photo when recipe has no image URL", async () => {
        const { server, callResource } = makeTestServer();

        const recipe = makeRecipe({ uid: "test-recipe" as RecipeUid, name: "Test", imageUrl: "" });
        const ctx = seed(makeCtx(new RecipeStore(), server), { recipes: [recipe] });
        registerRecipeResources(server, ctx);

        const result = (await callResource("recipes", "test-recipe")) as {
          contents: Array<{ text: string }>;
        };

        expect(result.contents[0]?.text).not.toContain("**Photo:**");
      });
    });

    describe("p2-u10-resource-reg.AC2.2: Category UIDs are resolved to display names", () => {
      it("shows resolved category names in markdown", async () => {
        const { server, callResource } = makeTestServer();

        const category = makeCategory({ uid: "cat-1" as CategoryUid, name: "Desserts" });
        const recipe = makeRecipe({
          uid: "recipe-1" as RecipeUid,
          name: "Cake",
          categories: ["cat-1" as CategoryUid],
        });
        const ctx = seed(makeCtx(new RecipeStore(), server), {
          recipes: [recipe],
          categories: [category],
        });
        registerRecipeResources(server, ctx);

        const result = (await callResource("recipes", "recipe-1")) as {
          contents: Array<{ text: string }>;
        };

        const text = result.contents[0]?.text;
        expect(text).toContain("**Categories:** Desserts");
      });
    });

    describe("p2-u10-resource-reg.AC2.3: Response includes correct mimeType and uri", () => {
      it("returns contents entry with text/markdown mimeType and uri.href", async () => {
        const { server, callResource } = makeTestServer();

        const recipe = makeRecipe({
          uid: "recipe-1" as RecipeUid,
          name: "Test",
          ingredients: "test",
          directions: "test",
        });
        const ctx = seed(makeCtx(new RecipeStore(), server), { recipes: [recipe] });
        registerRecipeResources(server, ctx);

        const result = (await callResource("recipes", "recipe-1")) as {
          contents: Array<{ uri: string; mimeType: string; text: string }>;
        };

        expect(result.contents[0]).toMatchObject({
          mimeType: "text/markdown",
          uri: "paprika://recipe/recipe-1",
        });
        expect(result.contents[0]?.text).toBeDefined();
      });
    });

    describe("p2-u10-resource-reg.AC2.4: Read handler throws error for nonexistent UID", () => {
      it("throws error when recipe UID does not exist", async () => {
        const { server, callResource } = makeTestServer();
        const ctx = seed(makeCtx(new RecipeStore(), server), { recipes: [] });
        registerRecipeResources(server, ctx);

        await expect(callResource("recipes", "nonexistent-uid")).rejects.toThrow();
      });
    });
  });
});
