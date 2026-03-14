import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { registerDeleteTool } from "./delete.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";

describe("p2-recipe-crud: delete_recipe tool", () => {
  describe("p2-recipe-crud.AC4: delete_recipe soft-deletes by UID", () => {
    it("p2-recipe-crud.AC4.1: recipe soft-deleted (inTrash: true) and confirmation returned", async () => {
      const recipe = makeRecipe({ name: "Pasta Carbonara" });
      const store = new RecipeStore();
      store.load([recipe], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const trashed = { ...recipe, inTrash: true };
      mockSaveRecipe.mockResolvedValue(trashed);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerDeleteTool(server, ctx);

      const result = await callTool("delete_recipe", { uid: recipe.uid });
      const text = getText(result);

      expect(text).toContain("Pasta Carbonara");
      expect(text.toLowerCase()).toContain("trash");
      expect(store.get(recipe.uid)?.inTrash).toBe(true);
    });

    it("p2-recipe-crud.AC4.2: saveRecipe called with inTrash: true, notifySync called once", async () => {
      const recipe = makeRecipe({ name: "Pasta Carbonara" });
      const store = new RecipeStore();
      store.load([recipe], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const trashed = { ...recipe, inTrash: true };
      mockSaveRecipe.mockResolvedValue(trashed);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerDeleteTool(server, ctx);

      await callTool("delete_recipe", { uid: recipe.uid });

      expect(mockSaveRecipe.mock.calls[0]?.[0]).toMatchObject({ inTrash: true });
      expect(mockNotifySync).toHaveBeenCalledOnce();
    });

    it("p2-recipe-crud.AC4.3: store.set and cache.putRecipe called with trashed recipe", async () => {
      const recipe = makeRecipe({ name: "Pasta Carbonara" });
      const store = new RecipeStore();
      store.load([recipe], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const trashed = { ...recipe, inTrash: true };
      mockSaveRecipe.mockResolvedValue(trashed);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerDeleteTool(server, ctx);

      await callTool("delete_recipe", { uid: recipe.uid });

      expect(mockPutRecipe).toHaveBeenCalledWith(trashed, trashed.hash);
      expect(mockFlush).toHaveBeenCalledOnce();
      expect(store.get(recipe.uid)?.inTrash).toBe(true);
    });

    it("p2-recipe-crud.AC4.4: UID not found returns not-found message", async () => {
      const recipe = makeRecipe();
      const store = new RecipeStore();
      store.load([recipe], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerDeleteTool(server, ctx);

      const result = await callTool("delete_recipe", { uid: "nonexistent-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("no recipe found");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC4.5: recipe already in trash returns 'already in the trash' message", async () => {
      // Load both a non-trashed recipe (so store.size > 0) and a trashed recipe
      const nonTrashedRecipe = makeRecipe({ name: "Pasta Bolognese" });
      const trashedRecipe = makeRecipe({ name: "Trashed Recipe", inTrash: true });
      const store = new RecipeStore();
      store.load([nonTrashedRecipe, trashedRecipe], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerDeleteTool(server, ctx);

      const result = await callTool("delete_recipe", { uid: trashedRecipe.uid });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("already in the trash");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC4.6: saveRecipe throws — returns error message", async () => {
      const recipe = makeRecipe();
      const store = new RecipeStore();
      store.load([recipe], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      mockSaveRecipe.mockRejectedValue(new Error("API timeout"));

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerDeleteTool(server, ctx);

      const result = await callTool("delete_recipe", { uid: recipe.uid });
      const text = getText(result);

      expect(text).toContain("Failed to delete");
      expect(text).toContain("API timeout");
      expect(mockPutRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC4.7: cold-start guard fires before store lookup", async () => {
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
      registerDeleteTool(server, ctx);

      const result = await callTool("delete_recipe", { uid: "any-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
    });
  });
});
