import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerUpdateTool } from "./update.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";

describe("p2-recipe-crud: update_recipe tool", () => {
  describe("p2-recipe-crud.AC3: update_recipe applies partial updates", () => {
    it("p2-recipe-crud.AC3.1: provided fields are updated, omitted fields retain existing values", async () => {
      const recipe = makeRecipe({ name: "Old Name", servings: "2" });
      const store = new RecipeStore();
      store.load([recipe], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const updated = makeRecipe({ name: "New Name", servings: "2" });
      mockSaveRecipe.mockResolvedValue(updated);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerUpdateTool(server, ctx);

      await callTool("update_recipe", { uid: recipe.uid, name: "New Name" });

      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.name).toBe("New Name");
      expect(callArgs?.servings).toBe("2"); // unchanged from existing
    });

    it("p2-recipe-crud.AC3.2: providing categories replaces existing list entirely", async () => {
      const catA = makeCategory({ name: "Category A" });
      const catB = makeCategory({ name: "Category B" });
      const recipe = makeRecipe({ categories: [catA.uid] });
      const store = new RecipeStore();
      store.load([recipe], [catA, catB]);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const updated = makeRecipe({ categories: [catB.uid] });
      mockSaveRecipe.mockResolvedValue(updated);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerUpdateTool(server, ctx);

      await callTool("update_recipe", { uid: recipe.uid, categories: ["Category B"] });

      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.categories).toEqual([catB.uid]);
      expect(callArgs?.categories).not.toContain(catA.uid);
    });

    it("p2-recipe-crud.AC3.3: omitting categories leaves existing categories unchanged", async () => {
      const catA = makeCategory({ name: "Category A" });
      const recipe = makeRecipe({ categories: [catA.uid] });
      const store = new RecipeStore();
      store.load([recipe], [catA]);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const updated = makeRecipe({ name: "New Name", categories: [catA.uid] });
      mockSaveRecipe.mockResolvedValue(updated);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerUpdateTool(server, ctx);

      await callTool("update_recipe", { uid: recipe.uid, name: "New Name" });

      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.categories).toEqual([catA.uid]); // unchanged
    });

    it("p2-recipe-crud.AC3.4: saveRecipe and notifySync called exactly once with merged recipe", async () => {
      const recipe = makeRecipe({ name: "Old", servings: "4" });
      const store = new RecipeStore();
      store.load([recipe], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const updated = makeRecipe({ name: "New", servings: "4" });
      mockSaveRecipe.mockResolvedValue(updated);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerUpdateTool(server, ctx);

      await callTool("update_recipe", { uid: recipe.uid, name: "New" });

      expect(mockSaveRecipe).toHaveBeenCalledOnce();
      expect(mockNotifySync).toHaveBeenCalledOnce();
      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.name).toBe("New");
      expect(callArgs?.servings).toBe("4");
    });

    it("p2-recipe-crud.AC3.5: UID not found returns not-found message", async () => {
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
      registerUpdateTool(server, ctx);

      const result = await callTool("update_recipe", { uid: "nonexistent-uid", name: "New" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("no recipe found");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC3.6: saveRecipe throws — returns error message, store not updated", async () => {
      const recipe = makeRecipe();
      const store = new RecipeStore();
      store.load([recipe], []);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      mockSaveRecipe.mockRejectedValue(new Error("Conflict"));

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerUpdateTool(server, ctx);

      const result = await callTool("update_recipe", { uid: recipe.uid, name: "New" });
      const text = getText(result);

      expect(text).toContain("Failed to update");
      expect(text).toContain("Conflict");
      expect(mockPutRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC3.7: cold-start guard fires before store lookup", async () => {
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
      registerUpdateTool(server, ctx);

      const result = await callTool("update_recipe", { uid: "any-uid", name: "New" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("p2-recipe-crud.AC3.X (edge case): empty categories array replaces with empty list", async () => {
      const catA = makeCategory({ name: "Category A" });
      const recipe = makeRecipe({ categories: [catA.uid] });
      const store = new RecipeStore();
      store.load([recipe], [catA]);

      const mockSaveRecipe = vi.fn();
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockPutRecipe = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const updated = makeRecipe({ categories: [] });
      mockSaveRecipe.mockResolvedValue(updated);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: { saveRecipe: mockSaveRecipe, notifySync: mockNotifySync } as unknown as PaprikaClient,
        cache: { putRecipe: mockPutRecipe, flush: mockFlush } as unknown as DiskCache,
      });
      registerUpdateTool(server, ctx);

      await callTool("update_recipe", { uid: recipe.uid, categories: [] });

      const callArgs = mockSaveRecipe.mock.calls[0]?.[0];
      expect(callArgs?.categories).toEqual([]); // empty array correctly replaces
    });
  });
});
