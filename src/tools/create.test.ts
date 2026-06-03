import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import { makeCategory, makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerCreateTool } from "./create.js";

describe("p2-recipe-crud: create_recipe tool", () => {
  describe("p2-recipe-crud.AC2: create_recipe creates and persists a new recipe", () => {
    it("p2-recipe-crud.AC2.1: required fields create a recipe returned as markdown", async () => {
      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe({ name: "Soup" });
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe()] },
      );
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
      // The new recipe's UID is surfaced directly so the caller doesn't have to
      // look it up to follow create_recipe with upload_photo / update_recipe.
      expect(text).toContain(savedRecipe.uid);
    });

    it("p2-recipe-crud.AC2.2: optional fields are reflected in returned recipe", async () => {
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
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe()] },
      );
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
      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe();
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe()] },
      );
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

    it("p2-recipe-crud.AC2.3b: created is emitted in Paprika wire format, not ISO-8601 (regression #159)", async () => {
      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      mockSaveRecipe.mockResolvedValue(makeRecipe());

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe()] },
      );
      registerCreateTool(server, ctx);

      await callTool("create_recipe", {
        name: "Dated Recipe",
        ingredients: "one ingredient",
        directions: "do it",
      });

      // Paprika's /sync/recipe/ endpoint rejects ISO-8601 `created` with HTTP 500;
      // it requires the wire format `yyyy-MM-dd HH:mm:ss` (no T, no Z, no millis).
      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.created).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
      expect(callArgs?.created).not.toContain("T");
      expect(callArgs?.created).not.toContain("Z");
    });

    it("p2-recipe-crud.AC2.4: category names are resolved to UIDs", async () => {
      const category = makeCategory({ name: "Soups" });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe({ categories: [category.uid] });
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe()], categories: [category] },
      );
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
      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe();
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe()] },
      );
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
      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe({ name: "Saved Recipe" });
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe()] },
      );
      registerCreateTool(server, ctx);

      await callTool("create_recipe", {
        name: "Saved Recipe",
        ingredients: "ingredients",
        directions: "directions",
      });

      expect(mockPutRecipe).toHaveBeenCalledWith(savedRecipe);
      expect(mockFlush).toHaveBeenCalledOnce();
      expect(ctx.store.get(savedRecipe.uid)).toEqual(savedRecipe);
    });

    it("p2-recipe-crud.AC2.7: unknown category name is skipped with warning", async () => {
      const category = makeCategory({ name: "Desserts" });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const savedRecipe = makeRecipe({ categories: [category.uid] });
      mockSaveRecipe.mockResolvedValue(savedRecipe);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe()], categories: [category] },
      );
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
      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      mockSaveRecipe.mockRejectedValue(new Error("Network error"));

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe()] },
      );
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
      // store not loaded — size === 0

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
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
