import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerCreateTool } from "./create.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";

describe("p2-recipe-crud: create_recipe tool", () => {
  describe("p2-recipe-crud.AC2: create_recipe creates and persists a new recipe", () => {
    it("p2-recipe-crud.AC2.1: required fields create a recipe returned as markdown", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []); // non-empty store

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe({ name: "Soup" });
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerCreateTool(server, ctx);

      const result = await callTool("create_recipe", {
        name: "Soup",
        ingredients: "water, salt",
        directions: "boil water, add salt",
      });
      const text = getText(result);

      expect(text).toContain("# Soup");
      expect(text).toContain("## Ingredients");
      expect(text).toContain("## Directions");
    });

    it("p2-recipe-crud.AC2.2: optional fields are reflected in returned recipe", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe({
        name: "Pasta",
        description: "Tasty pasta",
        servings: "4",
        prepTime: "10 min",
      });
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerCreateTool(server, ctx);

      const result = await callTool("create_recipe", {
        name: "Pasta",
        ingredients: "pasta, sauce",
        directions: "boil and combine",
        description: "Tasty pasta",
        servings: "4",
        prepTime: "10 min",
      });
      const text = getText(result);

      expect(text).toContain("Tasty pasta");
      expect(text).toContain("**Servings:** 4");
      expect(text).toContain("Prep: 10 min");
    });

    it("p2-recipe-crud.AC2.3: omitted optional fields default to null", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe();
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerCreateTool(server, ctx);

      await callTool("create_recipe", {
        name: "Simple Recipe",
        ingredients: "one ingredient",
        directions: "do it",
      });

      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs).toBeDefined();
      expect(callArgs?.description).toBe(null);
      expect(callArgs?.notes).toBe(null);
      expect(callArgs?.servings).toBe(null);
      expect(callArgs?.prepTime).toBe(null);
      expect(callArgs?.cookTime).toBe(null);
      expect(callArgs?.totalTime).toBe(null);
      expect(callArgs?.difficulty).toBe(null);
      expect(callArgs?.rating).toBe(0);
    });

    it("p2-recipe-crud.AC2.4: category names are resolved to UIDs", async () => {
      const category = makeCategory({ name: "Soups" });
      const store = new RecipeStore();
      store.load([makeRecipe()], [category]);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe({ categories: [category.uid] });
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerCreateTool(server, ctx);

      await callTool("create_recipe", {
        name: "Soup",
        ingredients: "ingredients",
        directions: "directions",
        categories: ["Soups"],
      });

      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.categories).toContain(category.uid);
    });

    it("p2-recipe-crud.AC2.5: saveRecipe and notifySync called exactly once each", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe();
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerCreateTool(server, ctx);

      await callTool("create_recipe", {
        name: "Recipe",
        ingredients: "ingredients",
        directions: "directions",
      });

      expect(mockSaveRecipe).toHaveBeenCalledOnce();
      expect(mockNotifySync).toHaveBeenCalledOnce();
    });

    it("p2-recipe-crud.AC2.6: store.set and cache.putRecipe called with saved recipe", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe({ name: "Saved Recipe" });
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerCreateTool(server, ctx);

      await callTool("create_recipe", {
        name: "Saved Recipe",
        ingredients: "ingredients",
        directions: "directions",
      });

      expect(mockPutRecipe).toHaveBeenCalledWith(savedRecipe, savedRecipe.hash);
      expect(mockFlush).toHaveBeenCalledOnce();
      expect(store.get(savedRecipe.uid)).toEqual(savedRecipe);
    });

    it("p2-recipe-crud.AC2.7: unknown category name is skipped with warning", async () => {
      const category = makeCategory({ name: "Desserts" });
      const store = new RecipeStore();
      store.load([makeRecipe()], [category]);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe({ categories: [category.uid] });
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerCreateTool(server, ctx);

      const result = await callTool("create_recipe", {
        name: "Recipe",
        ingredients: "ingredients",
        directions: "directions",
        categories: ["Desserts", "UnknownCat"],
      });
      const text = getText(result);

      expect(text).toContain('Warning: category "UnknownCat" not found');
      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.categories).toEqual([category.uid]);
      expect(callArgs?.categories).not.toContain("UnknownCat");
    });

    it("p2-recipe-crud.AC2.8: saveRecipe throws — returns error, store/cache not updated", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      mockSaveRecipe.mockRejectedValue(new Error("Network error"));

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerCreateTool(server, ctx);

      const result = await callTool("create_recipe", {
        name: "Recipe",
        ingredients: "ingredients",
        directions: "directions",
      });
      const text = getText(result);

      expect(text).toContain("Failed to create");
      expect(text).toContain("Network error");
      expect(mockPutRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC2.9: cold-start guard fires before any API call", async () => {
      const store = new RecipeStore(); // not loaded — size === 0

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerCreateTool(server, ctx);

      const result = await callTool("create_recipe", {
        name: "Recipe",
        ingredients: "ingredients",
        directions: "directions",
      });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });
  });
});
