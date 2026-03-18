import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeTestServer, makeCtx } from "../tools/tool-test-utils.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerRecipeResources } from "./recipes.js";
import type { RecipeUid, CategoryUid } from "../paprika/types.js";

describe("p2-u10-resource-reg: MCP Recipe Resources", () => {
  describe("p2-u10-resource-reg.AC1: Recipe list is accessible as MCP resources", () => {
    describe("p2-u10-resource-reg.AC1.1: List handler returns all non-trashed recipes with correct metadata", () => {
      it("returns recipes with uri, name, and mimeType for each", async () => {
        const { server, callResourceList } = makeTestServer();
        const store = new RecipeStore();

        const recipe1 = makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Pasta" });
        const recipe2 = makeRecipe({ uid: "recipe-2" as RecipeUid, name: "Salad" });
        store.load([recipe1, recipe2], []);

        const ctx = makeCtx(store, server);
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
        const store = new RecipeStore();
        store.load([], []);

        const ctx = makeCtx(store, server);
        registerRecipeResources(server, ctx);

        const result = (await callResourceList("recipes")) as { resources: Array<unknown> };

        expect(result).toEqual({ resources: [] });
      });
    });

    describe("p2-u10-resource-reg.AC1.3: Trashed recipes are excluded from the list", () => {
      it("excludes recipes with inTrash: true from results", async () => {
        const { server, callResourceList } = makeTestServer();
        const store = new RecipeStore();

        const nonTrashed = makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Good Recipe" });
        const trashed = makeRecipe({ uid: "recipe-2" as RecipeUid, name: "Trashed Recipe", inTrash: true });
        store.load([nonTrashed, trashed], []);

        const ctx = makeCtx(store, server);
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
    describe("p2-u10-resource-reg.AC2.1: Read handler returns content with UID header", () => {
      it("prepends **UID:** header to recipe markdown", async () => {
        const { server, callResource } = makeTestServer();
        const store = new RecipeStore();

        const recipe = makeRecipe({
          uid: "test-recipe" as RecipeUid,
          name: "Test Recipe",
          ingredients: "flour, sugar",
          directions: "Mix and bake",
        });
        store.load([recipe], []);

        const ctx = makeCtx(store, server);
        registerRecipeResources(server, ctx);

        const result = (await callResource("recipes", "test-recipe")) as {
          contents: Array<{ text: string }>;
        };

        const text = result.contents[0]?.text;
        expect(text).toMatch(/^\*\*UID:\*\*\s`test-recipe`/);
      });
    });

    describe("p2-u10-resource-reg.AC2.2: Category UIDs are resolved to display names", () => {
      it("shows resolved category names in markdown", async () => {
        const { server, callResource } = makeTestServer();
        const store = new RecipeStore();

        const category = makeCategory({ uid: "cat-1" as CategoryUid, name: "Desserts" });
        const recipe = makeRecipe({
          uid: "recipe-1" as RecipeUid,
          name: "Cake",
          categories: ["cat-1" as CategoryUid],
        });
        store.load([recipe], [category]);

        const ctx = makeCtx(store, server);
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
        const store = new RecipeStore();

        const recipe = makeRecipe({
          uid: "recipe-1" as RecipeUid,
          name: "Test",
          ingredients: "test",
          directions: "test",
        });
        store.load([recipe], []);

        const ctx = makeCtx(store, server);
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
        const store = new RecipeStore();
        store.load([], []);

        const ctx = makeCtx(store, server);
        registerRecipeResources(server, ctx);

        await expect(callResource("recipes", "nonexistent-uid")).rejects.toThrow();
      });
    });
  });
});
