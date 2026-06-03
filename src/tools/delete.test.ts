import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import { makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerDeleteTool } from "./delete.js";

describe("p2-recipe-crud: trash_recipe tool", () => {
  describe("p2-recipe-crud.AC4: trash_recipe soft-deletes by UID", () => {
    it("p2-recipe-crud.AC4.1: recipe soft-deleted (inTrash: true) and confirmation returned", async () => {
      const recipe = makeRecipe({ name: "Pasta Carbonara" });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const trashed = { ...recipe, inTrash: true };
      mockSaveRecipe.mockResolvedValue(trashed);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerDeleteTool(server, ctx);

      const result = await callTool("trash_recipe", { uid: recipe.uid });
      const text = getText(result);

      expect(text).toContain("Pasta Carbonara");
      expect(text.toLowerCase()).toContain("trash");
      expect(ctx.store.get(recipe.uid)?.inTrash).toBe(true);
    });

    it("p2-recipe-crud.AC4.2: saveRecipe called with inTrash: true, notifySync called once", async () => {
      const recipe = makeRecipe({ name: "Pasta Carbonara" });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const trashed = { ...recipe, inTrash: true };
      mockSaveRecipe.mockResolvedValue(trashed);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerDeleteTool(server, ctx);

      await callTool("trash_recipe", { uid: recipe.uid });

      expect(mockSaveRecipe.mock.calls[0]?.[0]).toMatchObject({ inTrash: true });
      expect(mockNotifySync).toHaveBeenCalledOnce();
    });

    it("p2-recipe-crud.AC4.3: store.set and cache.putRecipe called with trashed recipe", async () => {
      const recipe = makeRecipe({ name: "Pasta Carbonara" });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const trashed = { ...recipe, inTrash: true };
      mockSaveRecipe.mockResolvedValue(trashed);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerDeleteTool(server, ctx);

      await callTool("trash_recipe", { uid: recipe.uid });

      expect(mockPutRecipe).toHaveBeenCalledWith(trashed);
      expect(mockFlush).toHaveBeenCalledOnce();
      expect(ctx.store.get(recipe.uid)?.inTrash).toBe(true);
    });

    it("p2-recipe-crud.AC4.4: UID not found returns not-found message", async () => {
      const recipe = makeRecipe();

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerDeleteTool(server, ctx);

      const result = await callTool("trash_recipe", { uid: "nonexistent-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("no recipe found");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC4.5: recipe already in trash returns 'already in the trash' message", async () => {
      // Load both a non-trashed recipe (so store.size > 0) and a trashed recipe
      const nonTrashedRecipe = makeRecipe({ name: "Pasta Bolognese" });
      const trashedRecipe = makeRecipe({ name: "Trashed Recipe", inTrash: true });

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [nonTrashedRecipe, trashedRecipe] },
      );
      registerDeleteTool(server, ctx);

      const result = await callTool("trash_recipe", { uid: trashedRecipe.uid });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("already in the trash");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC4.6: saveRecipe throws — returns error message", async () => {
      const recipe = makeRecipe();

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      mockSaveRecipe.mockRejectedValue(new Error("API timeout"));

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { put: mockPutRecipe }, flush: mockFlush }),
        }),
        { recipes: [recipe] },
      );
      registerDeleteTool(server, ctx);

      const result = await callTool("trash_recipe", { uid: recipe.uid });
      const text = getText(result);

      expect(text).toContain("Failed to delete");
      expect(text).toContain("API timeout");
      expect(mockPutRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC4.7: cold-start guard fires before store lookup", async () => {
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
      registerDeleteTool(server, ctx);

      const result = await callTool("trash_recipe", { uid: "any-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
    });
  });
});
