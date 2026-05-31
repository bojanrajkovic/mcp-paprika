import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { registerEmptyTrashTool } from "./empty-trash.js";
import { makeTestServer, makeCtx, makeStubNotifier, getText } from "./tool-test-utils.js";

// Shared cache/client mocks for the hard-delete commit path. Unlike the soft-delete
// tool, the commit REMOVES from the cache (recipes.remove), so the mock exposes
// remove rather than put.
function makeMocks(savedOverride?: unknown) {
  const mockSaveRecipe = vi.fn().mockResolvedValue(savedOverride);
  const mockNotifySync = vi.fn().mockResolvedValue(undefined);
  const mockRemove = vi.fn().mockResolvedValue(undefined);
  const mockFlush = vi.fn().mockResolvedValue(undefined);
  return { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush };
}

describe("recipe-hard-delete: empty_trash tool (#125)", () => {
  describe("empty-trash.AC1: permanently deletes a trashed recipe", () => {
    it("empty-trash.AC1.1: trashed recipe hard-deleted with confirmation", async () => {
      const live = makeRecipe({ name: "Keeper" }); // keeps store.size > 0
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const store = new RecipeStore();
      store.load([live, trashed], []);

      const tombstone = { ...trashed, inTrash: true, deleted: true };
      const { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(tombstone);

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
      });
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: trashed.uid });
      const text = getText(result);

      expect(text).toContain("Old Soup");
      expect(text.toLowerCase()).toContain("permanently deleted");
      // gone from the store entirely (not just hidden)
      expect(store.get(trashed.uid)).toBeUndefined();
    });

    it("empty-trash.AC1.2: saveRecipe sent with both in_trash and deleted true", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const store = new RecipeStore();
      store.load([trashed], []);

      const { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks({
        ...trashed,
        inTrash: true,
        deleted: true,
      });

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
      });
      registerEmptyTrashTool(server, ctx);

      await callTool("empty_trash", { uid: trashed.uid });

      expect(mockSaveRecipe.mock.calls[0]?.[0]).toMatchObject({ inTrash: true, deleted: true });
      expect(mockNotifySync).toHaveBeenCalledOnce();
    });

    it("empty-trash.AC1.3: commit removes from cache and notifies clients", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const store = new RecipeStore();
      store.load([trashed], []);

      const { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks({
        ...trashed,
        inTrash: true,
        deleted: true,
      });
      const { notifier, resourceListChanged } = makeStubNotifier();

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
        notifier,
      });
      registerEmptyTrashTool(server, ctx);

      await callTool("empty_trash", { uid: trashed.uid });

      expect(mockRemove).toHaveBeenCalledWith(trashed.uid);
      expect(mockFlush).toHaveBeenCalledOnce();
      expect(resourceListChanged).toHaveBeenCalledOnce();
    });
  });

  describe("empty-trash.AC2: guards against destroying live recipes", () => {
    it("empty-trash.AC2.1: a live (non-trashed) recipe is refused with a delete_recipe-first hint", async () => {
      const live = makeRecipe({ name: "Dinner Tonight" });
      const store = new RecipeStore();
      store.load([live], []);

      const { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks();

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
      });
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: live.uid });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("not in the trash");
      expect(text).toContain("delete_recipe");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
      expect(store.get(live.uid)).toBeDefined(); // untouched
    });

    it("empty-trash.AC2.2: unknown UID returns a not-found / already-deleted message", async () => {
      const live = makeRecipe({ name: "Keeper" });
      const store = new RecipeStore();
      store.load([live], []);

      const { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks();

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
      });
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: "nonexistent-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("no recipe found");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("empty-trash.AC2.3: idempotent — a second empty_trash on the same UID reports already-deleted", async () => {
      const live = makeRecipe({ name: "Keeper" });
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const store = new RecipeStore();
      store.load([live, trashed], []);

      const { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks({
        ...trashed,
        inTrash: true,
        deleted: true,
      });

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
      });
      registerEmptyTrashTool(server, ctx);

      await callTool("empty_trash", { uid: trashed.uid }); // first: purges
      const second = await callTool("empty_trash", { uid: trashed.uid }); // second: already gone
      const text = getText(second);

      expect(text.toLowerCase()).toContain("no recipe found");
      expect(mockSaveRecipe).toHaveBeenCalledOnce(); // not POSTed again
    });
  });

  describe("empty-trash.AC3: failure handling", () => {
    it("empty-trash.AC3.1: saveRecipe throws — error surfaced, recipe retained", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const store = new RecipeStore();
      store.load([trashed], []);

      const { mockNotifySync, mockRemove, mockFlush } = makeMocks();
      const mockSaveRecipe = vi.fn().mockRejectedValue(new Error("API timeout"));

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
      });
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: trashed.uid });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("failed to permanently delete");
      expect(text).toContain("API timeout");
      expect(store.get(trashed.uid)).toBeDefined(); // still present — not purged on failure
    });
  });

  describe("empty-trash.AC4: cold-start guard", () => {
    it("empty-trash.AC4.1: store not yet synced returns the cold-start message", async () => {
      const store = new RecipeStore(); // never load()ed → hasSynced false
      const { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks();

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(store, server, {
        client: fromAny({ saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
      });
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: "any-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("not yet synced");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });
  });
});
