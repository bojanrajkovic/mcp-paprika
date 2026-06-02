import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../recipe/store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { PaprikaAPIError } from "../paprika/errors.js";
import { registerEmptyTrashTool } from "./empty-trash.js";
import { makeTestServer, makeCtx, makeStubNotifier, getText, seed } from "./tool-test-utils.js";

// empty_trash fetches authoritative state via ctx.client.getRecipe (NOT the local
// store, which can lag app-side trash actions). The store only needs hasSynced so the
// cold-start guard passes; the commit path uses cache.recipes.remove (not put).

function makeMocks(getRecipeImpl: ReturnType<typeof vi.fn>, savedOverride?: unknown) {
  const mockGetRecipe = getRecipeImpl;
  const mockSaveRecipe = vi.fn().mockResolvedValue(savedOverride);
  const mockNotifySync = vi.fn().mockResolvedValue(undefined);
  const mockRemove = vi.fn().mockResolvedValue(undefined);
  const mockFlush = vi.fn().mockResolvedValue(undefined);
  return { mockGetRecipe, mockSaveRecipe, mockNotifySync, mockRemove, mockFlush };
}

const notFound = (uid: string): PaprikaAPIError => new PaprikaAPIError("Not found", 404, `/api/v2/sync/recipe/${uid}/`);

describe("recipe-hard-delete: empty_trash tool (#125)", () => {
  describe("empty-trash.AC1: permanently deletes a trashed recipe (authoritative lookup)", () => {
    it("empty-trash.AC1.1: trashed recipe hard-deleted with confirmation", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const tombstone = { ...trashed, inTrash: true, deleted: true };
      const { mockGetRecipe, mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(
        vi.fn().mockResolvedValue(trashed),
        tombstone,
      );

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe({ name: "Keeper" })] }, // flips hasSynced; content irrelevant to lookup
      );
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: trashed.uid });
      const text = getText(result);

      expect(mockGetRecipe).toHaveBeenCalledWith(trashed.uid);
      expect(text).toContain("Old Soup");
      expect(text.toLowerCase()).toContain("permanently deleted");
    });

    it("empty-trash.AC1.2: saveRecipe sent with both in_trash and deleted true", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const { mockGetRecipe, mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(
        vi.fn().mockResolvedValue(trashed),
        { ...trashed, inTrash: true, deleted: true },
      );

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe({ name: "Keeper" })] }, // flips hasSynced; content irrelevant to lookup
      );
      registerEmptyTrashTool(server, ctx);

      await callTool("empty_trash", { uid: trashed.uid });

      expect(mockSaveRecipe.mock.calls[0]?.[0]).toMatchObject({ inTrash: true, deleted: true });
      expect(mockNotifySync).toHaveBeenCalledOnce();
    });

    it("empty-trash.AC1.3: commit removes from cache and notifies clients", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const { mockGetRecipe, mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(
        vi.fn().mockResolvedValue(trashed),
        { ...trashed, inTrash: true, deleted: true },
      );
      const { notifier, resourceListChanged } = makeStubNotifier();

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
          notifier,
        }),
        { recipes: [makeRecipe({ name: "Keeper" })] }, // flips hasSynced; content irrelevant to lookup
      );
      registerEmptyTrashTool(server, ctx);

      await callTool("empty_trash", { uid: trashed.uid });

      expect(mockRemove).toHaveBeenCalledWith(trashed.uid);
      expect(mockFlush).toHaveBeenCalledOnce();
      expect(resourceListChanged).toHaveBeenCalledOnce();
    });

    it("empty-trash.AC1.4: deletes a recipe trashed app-side that the local store would miss", async () => {
      // The local store has NO knowledge of this UID (trashed in the app, not yet synced),
      // but the authoritative getRecipe returns it with inTrash:true — so it still deletes.
      const appTrashed = makeRecipe({ name: "Trashed In App", inTrash: true });
      const { mockGetRecipe, mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(
        vi.fn().mockResolvedValue(appTrashed),
        { ...appTrashed, inTrash: true, deleted: true },
      );

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe({ name: "Keeper" })] }, // flips hasSynced; content irrelevant to lookup
      );
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: appTrashed.uid });

      expect(getText(result).toLowerCase()).toContain("permanently deleted");
      expect(mockSaveRecipe).toHaveBeenCalledOnce();
    });
  });

  describe("empty-trash.AC2: guards against destroying live recipes", () => {
    it("empty-trash.AC2.1: a live (non-trashed) recipe is refused with a delete_recipe-first hint", async () => {
      const live = makeRecipe({ name: "Dinner Tonight", inTrash: false });
      const { mockGetRecipe, mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(
        vi.fn().mockResolvedValue(live),
      );

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe({ name: "Keeper" })] }, // flips hasSynced; content irrelevant to lookup
      );
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: live.uid });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("not in the trash");
      expect(text).toContain("delete_recipe");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("empty-trash.AC2.2: 404 from getRecipe returns a not-found / already-deleted message", async () => {
      const { mockGetRecipe, mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(
        vi.fn().mockRejectedValue(notFound("nonexistent-uid")),
      );

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe({ name: "Keeper" })] }, // flips hasSynced; content irrelevant to lookup
      );
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: "nonexistent-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("no recipe found");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });

    it("empty-trash.AC2.3: idempotent — a second empty_trash on the same UID reports already-deleted", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      // First lookup returns the trashed recipe; after it's purged, the second lookup 404s.
      const mockGetRecipe = vi.fn().mockResolvedValueOnce(trashed).mockRejectedValueOnce(notFound(trashed.uid));
      const { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(vi.fn(), {
        ...trashed,
        inTrash: true,
        deleted: true,
      });

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe({ name: "Keeper" })] }, // flips hasSynced; content irrelevant to lookup
      );
      registerEmptyTrashTool(server, ctx);

      await callTool("empty_trash", { uid: trashed.uid }); // first: purges
      const second = await callTool("empty_trash", { uid: trashed.uid }); // second: already gone

      expect(getText(second).toLowerCase()).toContain("no recipe found");
      expect(mockSaveRecipe).toHaveBeenCalledOnce(); // not POSTed again
    });
  });

  describe("empty-trash.AC3: failure handling", () => {
    it("empty-trash.AC3.1: saveRecipe throws — error surfaced, no false 'deleted'", async () => {
      const trashed = makeRecipe({ name: "Old Soup", inTrash: true });
      const mockGetRecipe = vi.fn().mockResolvedValue(trashed);
      const mockSaveRecipe = vi.fn().mockRejectedValue(new Error("API timeout"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const mockRemove = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockResolvedValue(undefined);

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe({ name: "Keeper" })] }, // flips hasSynced; content irrelevant to lookup
      );
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: trashed.uid });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("failed to permanently delete");
      expect(text).toContain("API timeout");
      expect(mockRemove).not.toHaveBeenCalled(); // not purged locally on failure
    });

    it("empty-trash.AC3.2: a transient (non-404) lookup error does NOT masquerade as already-deleted", async () => {
      const mockGetRecipe = vi
        .fn()
        .mockRejectedValue(new PaprikaAPIError("Server error", 503, "/api/v2/sync/recipe/x/"));
      const { mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(vi.fn());

      const { server, callTool } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
          cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
        }),
        { recipes: [makeRecipe({ name: "Keeper" })] }, // flips hasSynced; content irrelevant to lookup
      );
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: "some-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("failed to look up");
      expect(text.toLowerCase()).not.toContain("permanently deleted");
      expect(mockSaveRecipe).not.toHaveBeenCalled();
    });
  });

  describe("empty-trash.AC4: cold-start guard", () => {
    it("empty-trash.AC4.1: store not yet synced returns the cold-start message without fetching", async () => {
      const { mockGetRecipe, mockSaveRecipe, mockNotifySync, mockRemove, mockFlush } = makeMocks(vi.fn());

      const { server, callTool } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        // never load()ed → hasSynced false
        client: fromAny({ getRecipe: mockGetRecipe, saveRecipe: mockSaveRecipe, notifySync: mockNotifySync }),
        cache: fromAny({ recipes: { remove: mockRemove }, flush: mockFlush }),
      });
      registerEmptyTrashTool(server, ctx);

      const result = await callTool("empty_trash", { uid: "any-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("not yet synced");
      expect(mockGetRecipe).not.toHaveBeenCalled();
    });
  });
});
