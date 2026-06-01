import { describe, it, expect, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { PantryStore } from "../cache/pantry-store.js";
import { RecipeStore } from "../cache/recipe-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { commitPantryItem, commitPantryItemsBatch } from "./pantry-helpers.js";
import { makeTestServer, makeCtx, makeStubNotifier, seed } from "./tool-test-utils.js";

describe("pantry-mutations.AC3: commitPantryItem helper", () => {
  describe("AC3.1: upsert branch (deleted: false)", () => {
    it("should call putPantryItem, flush, set, notifySync in order", async () => {
      // Arrange
      const saved = makePantryItem({ deleted: false });
      const pantryStore = new PantryStore();
      const setSpy = vi.spyOn(pantryStore, "set");
      const _deleteSpy = vi.spyOn(pantryStore, "delete");

      const mockPutPantryItem = vi.fn();
      const mockRemovePantryItem = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
          flush: mockFlush,
        }),
        pantryStore,
        notifier: stub.notifier,
      });

      // Act
      await commitPantryItem(ctx, saved);

      // Assert: verify full ordering using invocationCallOrder
      expect(mockPutPantryItem.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(setSpy.mock.invocationCallOrder[0]!);
      expect(setSpy.mock.invocationCallOrder[0]).toBeLessThan(mockNotifySync.mock.invocationCallOrder[0]!);

      // Assert: no resource-list notification — pantry has no resource surface
      expect(stub.resourceListChanged).not.toHaveBeenCalled();

      // Assert: verify delete-branch mocks were NOT called
      expect(mockRemovePantryItem).not.toHaveBeenCalled();
      expect(_deleteSpy).not.toHaveBeenCalled();

      // Assert: verify item was set in store
      expect(setSpy).toHaveBeenCalledWith(saved);
      expect(pantryStore.get(saved.uid)).toEqual(saved);
    });
  });

  describe("AC3.2: delete branch (deleted: true)", () => {
    it("should call removePantryItem, flush, delete, notifySync in order", async () => {
      // Arrange
      const item = makePantryItem({ deleted: false });
      const saved = { ...item, deleted: true };
      const pantryStore = new PantryStore();
      const _setSpy = vi.spyOn(pantryStore, "set");
      const deleteSpy = vi.spyOn(pantryStore, "delete");

      const mockPutPantryItem = vi.fn();
      const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ notifySync: mockNotifySync }),
          cache: fromAny({
            pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
            flush: mockFlush,
          }),
          pantryStore,
          notifier: stub.notifier,
        }),
        { pantry: [item] },
      );

      // Act
      await commitPantryItem(ctx, saved);

      // Assert: verify full ordering using invocationCallOrder
      expect(mockRemovePantryItem.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(deleteSpy.mock.invocationCallOrder[0]!);
      expect(deleteSpy.mock.invocationCallOrder[0]).toBeLessThan(mockNotifySync.mock.invocationCallOrder[0]!);

      // Assert: no resource-list notification — pantry has no resource surface
      expect(stub.resourceListChanged).not.toHaveBeenCalled();

      // Assert: verify upsert-branch mocks were NOT called
      expect(mockPutPantryItem).not.toHaveBeenCalled();
      expect(_setSpy).not.toHaveBeenCalled();

      // Assert: verify item was deleted from store
      expect(deleteSpy).toHaveBeenCalledWith(saved.uid);
      expect(pantryStore.get(saved.uid)).toBeUndefined();
    });
  });

  describe("AC3.3: flush rejection propagation", () => {
    it("should reject when flush fails in upsert branch, preventing subsequent steps", async () => {
      // Arrange
      const saved = makePantryItem({ deleted: false });
      const pantryStore = new PantryStore();
      const setSpy = vi.spyOn(pantryStore, "set");
      vi.spyOn(pantryStore, "delete");

      const mockPutPantryItem = vi.fn();
      const mockRemovePantryItem = vi.fn();
      const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
          flush: mockFlush,
        }),
        pantryStore,
        notifier: stub.notifier,
      });

      // Act & Assert
      await expect(commitPantryItem(ctx, saved)).rejects.toThrow("flush failed");

      // Assert: putPantryItem WAS called (before flush)
      expect(mockPutPantryItem).toHaveBeenCalledWith(saved);

      // Assert: subsequent steps did NOT run
      expect(setSpy.mock.calls.length).toBe(0);
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();
      expect(pantryStore.get(saved.uid)).toBeUndefined();
    });

    it("should reject when flush fails in delete branch, preventing subsequent steps", async () => {
      // Arrange
      const item = makePantryItem({ deleted: false });
      const saved = { ...item, deleted: true };
      const pantryStore = new PantryStore();
      vi.spyOn(pantryStore, "set");
      const deleteSpy = vi.spyOn(pantryStore, "delete");

      const mockPutPantryItem = vi.fn();
      const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ notifySync: mockNotifySync }),
          cache: fromAny({
            pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
            flush: mockFlush,
          }),
          pantryStore,
          notifier: stub.notifier,
        }),
        { pantry: [item] },
      );

      // Act & Assert
      await expect(commitPantryItem(ctx, saved)).rejects.toThrow("flush failed");

      // Assert: removePantryItem WAS called (before flush)
      expect(mockRemovePantryItem).toHaveBeenCalledWith(saved.uid);

      // Assert: subsequent steps did NOT run
      expect(deleteSpy.mock.calls.length).toBe(0);
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();
      // Item should still be in store (not deleted by the helper)
      expect(pantryStore.get(saved.uid)).toEqual(item);
    });
  });

  describe("AC3.4: pending-mark rollback on commit failure (codex P2, PR #92)", () => {
    it("should clear pending-upsert mark when cache.putPantryItem rejects in upsert branch", async () => {
      const saved = makePantryItem({ deleted: false });
      const pantryStore = new PantryStore();

      const mockPutPantryItem = vi.fn().mockRejectedValue(new Error("disk full"));
      const mockRemovePantryItem = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
          flush: mockFlush,
        }),
        pantryStore,
        notifier: stub.notifier,
      });

      await expect(commitPantryItem(ctx, saved)).rejects.toThrow("disk full");

      // The pending-upsert mark must NOT persist past a failed commit, otherwise
      // sync would filter this UID for the TTL window and suppress reconciliation.
      expect(pantryStore.isPendingUpsert(saved.uid)).toBe(false);
      expect(pantryStore.isPendingDelete(saved.uid)).toBe(false);
    });

    it("should clear pending-delete mark when cache.removePantryItem rejects in delete branch", async () => {
      const item = makePantryItem({ deleted: false });
      const saved = { ...item, deleted: true };
      const pantryStore = new PantryStore();

      const mockPutPantryItem = vi.fn();
      const mockRemovePantryItem = vi.fn().mockRejectedValue(new Error("disk full"));
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = seed(
        makeCtx(new RecipeStore(), server, {
          client: fromAny({ notifySync: mockNotifySync }),
          cache: fromAny({
            pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
            flush: mockFlush,
          }),
          pantryStore,
          notifier: stub.notifier,
        }),
        { pantry: [item] },
      );

      await expect(commitPantryItem(ctx, saved)).rejects.toThrow("disk full");

      expect(pantryStore.isPendingDelete(saved.uid)).toBe(false);
      expect(pantryStore.isPendingUpsert(saved.uid)).toBe(false);
    });
  });
});

describe("commitPantryItemsBatch", () => {
  it("no-ops when items array is empty", async () => {
    const pantryStore = new PantryStore();
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({ pantry: {}, flush: mockFlush }),
      pantryStore,
      notifier: stub.notifier,
    });
    await commitPantryItemsBatch(ctx, []);
    expect(mockFlush).not.toHaveBeenCalled();
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(mockNotifySync).not.toHaveBeenCalled();
  });

  it("N items → exactly 1 flush, 1 notifySync, no resourceListChanged", async () => {
    const item1 = makePantryItem({ deleted: false });
    const item2 = makePantryItem({ deleted: false });
    const pantryStore = new PantryStore();
    const setSpy = vi.spyOn(pantryStore, "set");
    const mockPut = vi.fn().mockResolvedValue(undefined);
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPut, remove: mockRemove }, flush: mockFlush }),
      pantryStore,
      notifier: stub.notifier,
    });
    await commitPantryItemsBatch(ctx, [item1, item2]);
    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(mockNotifySync).toHaveBeenCalledTimes(1);
  });

  it("mixed upsert and delete in one batch", async () => {
    const upserted = makePantryItem({ deleted: false });
    const deleted = makePantryItem({ deleted: false });
    const deletedItem = { ...deleted, deleted: true };
    const pantryStore = new PantryStore();
    const setSpy = vi.spyOn(pantryStore, "set");
    const deleteSpy = vi.spyOn(pantryStore, "delete");
    const mockPut = vi.fn().mockResolvedValue(undefined);
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({ pantry: { put: mockPut, remove: mockRemove }, flush: mockFlush }),
        pantryStore,
        notifier: stub.notifier,
      }),
      { pantry: [deleted] },
    );
    await commitPantryItemsBatch(ctx, [upserted, deletedItem]);
    expect(mockPut).toHaveBeenCalledWith(upserted);
    expect(mockRemove).toHaveBeenCalledWith(deletedItem.uid);
    expect(setSpy).toHaveBeenCalledWith(upserted);
    expect(deleteSpy).toHaveBeenCalledWith(deletedItem.uid);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(mockNotifySync).toHaveBeenCalledTimes(1);
  });

  it("on cache flush failure, clears all pending marks before re-throwing", async () => {
    const item1 = makePantryItem({ deleted: false });
    const item2 = makePantryItem({ deleted: false });
    const pantryStore = new PantryStore();
    const clearPendingSpy = vi.spyOn(pantryStore, "clearPending");
    const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({
        pantry: { put: vi.fn().mockResolvedValue(undefined), remove: vi.fn() },
        flush: mockFlush,
      }),
      pantryStore,
      notifier: stub.notifier,
    });
    await expect(commitPantryItemsBatch(ctx, [item1, item2])).rejects.toThrow("flush failed");
    expect(clearPendingSpy).toHaveBeenCalledWith(item1.uid);
    expect(clearPendingSpy).toHaveBeenCalledWith(item2.uid);
    expect(pantryStore.isPendingUpsert(item1.uid)).toBe(false);
    expect(pantryStore.isPendingUpsert(item2.uid)).toBe(false);
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(mockNotifySync).not.toHaveBeenCalled();
  });

  it("on cache put failure, clears all pending marks and does not flush or notify", async () => {
    const item1 = makePantryItem({ deleted: false });
    const item2 = makePantryItem({ deleted: false });
    const pantryStore = new PantryStore();
    const clearPendingSpy = vi.spyOn(pantryStore, "clearPending");
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({
        pantry: {
          put: vi.fn().mockRejectedValue(new Error("disk full")),
          remove: vi.fn(),
        },
        flush: mockFlush,
      }),
      pantryStore,
      notifier: stub.notifier,
    });
    await expect(commitPantryItemsBatch(ctx, [item1, item2])).rejects.toThrow("disk full");
    expect(clearPendingSpy).toHaveBeenCalledWith(item1.uid);
    expect(clearPendingSpy).toHaveBeenCalledWith(item2.uid);
    expect(pantryStore.isPendingUpsert(item1.uid)).toBe(false);
    expect(pantryStore.isPendingUpsert(item2.uid)).toBe(false);
    expect(mockFlush).not.toHaveBeenCalled();
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(mockNotifySync).not.toHaveBeenCalled();
  });
});
