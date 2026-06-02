import { describe, it, expect, vi } from "vitest";
import { fromAny } from "@total-typescript/shoehorn";
import { GroceryItemStore } from "../grocery-item/store.js";
import { GroceryListStore } from "../grocery-list/store.js";
import { RecipeStore } from "../recipe/store.js";
import { makeGroceryItem } from "../cache/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../cache/__fixtures__/grocery-lists.js";
import { commitGroceryItem, commitGroceryItemsBatch, commitGroceryList, groceryStartGuard } from "./grocery-helpers.js";
import { makeCtx, makeStubNotifier, makeTestServer, getText, seed } from "./tool-test-utils.js";

describe("groceryStartGuard", () => {
  it("returns Err when neither store is synced", () => {
    const { server } = makeTestServer();
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });

    groceryStartGuard(ctx).match(
      () => {
        throw new Error("expected Err");
      },
      (guard) => {
        expect(getText(guard)).toContain("not yet synced");
      },
    );
  });

  it("returns Err when only groceryListStore is synced but not groceryItemStore", () => {
    const { server } = makeTestServer();
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    seed(ctx, { groceryLists: [] });
    // groceryItemStore deliberately not loaded

    groceryStartGuard(ctx).match(
      () => {
        throw new Error("expected Err");
      },
      (guard) => {
        expect(getText(guard)).toContain("not yet synced");
      },
    );
  });

  it("returns Err when only groceryItemStore is synced but not groceryListStore", () => {
    const { server } = makeTestServer();
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    seed(ctx, { groceryItems: [] });
    // groceryListStore deliberately not loaded

    groceryStartGuard(ctx).match(
      () => {
        throw new Error("expected Err");
      },
      (guard) => {
        expect(getText(guard)).toContain("not yet synced");
      },
    );
  });

  it("returns Ok when both stores are synced", () => {
    const { server } = makeTestServer();
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    seed(ctx, { groceryLists: [], groceryItems: [] });

    groceryStartGuard(ctx).match(
      () => {
        // ok — this is the success branch
      },
      () => {
        throw new Error("expected Ok");
      },
    );
  });
});

describe("commitGroceryList", () => {
  describe("upsert branch (deleted: false)", () => {
    it("calls markPendingUpsert, put, flush, set, resourceListChanged, notifySync in order", async () => {
      const list = makeGroceryList({ deleted: false });
      const groceryListStore = new GroceryListStore();
      const setSpy = vi.spyOn(groceryListStore, "set");
      const _deleteSpy = vi.spyOn(groceryListStore, "delete");

      const mockPutGroceryList = vi.fn();
      const mockRemoveGroceryList = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          groceryLists: { put: mockPutGroceryList, remove: mockRemoveGroceryList },
          flush: mockFlush,
        }),
        groceryListStore,
        notifier: stub.notifier,
      });

      await commitGroceryList(ctx, list);

      // Assert ordering via invocationCallOrder
      expect(mockPutGroceryList.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(setSpy.mock.invocationCallOrder[0]!);
      expect(setSpy.mock.invocationCallOrder[0]).toBeLessThan(stub.resourceListChanged.mock.invocationCallOrder[0]!);
      expect(stub.resourceListChanged.mock.invocationCallOrder[0]).toBeLessThan(
        mockNotifySync.mock.invocationCallOrder[0]!,
      );

      // Assert resourceListChanged called exactly once
      expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);

      // Assert delete-branch was NOT called
      expect(mockRemoveGroceryList).not.toHaveBeenCalled();
      expect(_deleteSpy).not.toHaveBeenCalled();

      // Assert set was called with the list
      expect(setSpy).toHaveBeenCalledWith(list);
    });
  });

  describe("delete branch (deleted: true)", () => {
    it("calls markPendingDelete, remove, flush, delete, resourceListChanged, notifySync in order", async () => {
      const list = makeGroceryList({ deleted: false });
      const deletedList = { ...list, deleted: true };
      const groceryListStore = new GroceryListStore();
      const _setSpy = vi.spyOn(groceryListStore, "set");
      const deleteSpy = vi.spyOn(groceryListStore, "delete");

      const mockPutGroceryList = vi.fn();
      const mockRemoveGroceryList = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          groceryLists: { put: mockPutGroceryList, remove: mockRemoveGroceryList },
          flush: mockFlush,
        }),
        groceryListStore,
        notifier: stub.notifier,
      });
      seed(ctx, { groceryLists: [list] });

      await commitGroceryList(ctx, deletedList);

      // Assert ordering via invocationCallOrder
      expect(mockRemoveGroceryList.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(deleteSpy.mock.invocationCallOrder[0]!);
      expect(deleteSpy.mock.invocationCallOrder[0]).toBeLessThan(stub.resourceListChanged.mock.invocationCallOrder[0]!);
      expect(stub.resourceListChanged.mock.invocationCallOrder[0]).toBeLessThan(
        mockNotifySync.mock.invocationCallOrder[0]!,
      );

      // Assert resourceListChanged called exactly once
      expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);

      // Assert upsert-branch was NOT called
      expect(mockPutGroceryList).not.toHaveBeenCalled();
      expect(_setSpy).not.toHaveBeenCalled();

      // Assert delete was called with the uid
      expect(deleteSpy).toHaveBeenCalledWith(deletedList.uid);
    });
  });

  describe("flush rejection propagation", () => {
    it("throws when flush fails in upsert branch; set, resourceListChanged, notifySync not called; clearPending called", async () => {
      const list = makeGroceryList({ deleted: false });
      const groceryListStore = new GroceryListStore();
      const setSpy = vi.spyOn(groceryListStore, "set");
      const clearPendingSpy = vi.spyOn(groceryListStore, "clearPending");

      const mockPutGroceryList = vi.fn();
      const mockRemoveGroceryList = vi.fn();
      const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          groceryLists: { put: mockPutGroceryList, remove: mockRemoveGroceryList },
          flush: mockFlush,
        }),
        groceryListStore,
        notifier: stub.notifier,
      });

      await expect(commitGroceryList(ctx, list)).rejects.toThrow("flush failed");

      // put WAS called (before flush)
      expect(mockPutGroceryList).toHaveBeenCalledWith(list);

      // Subsequent steps did NOT run
      expect(setSpy).not.toHaveBeenCalled();
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();

      // clearPending was called to roll back the pending mark
      expect(clearPendingSpy).toHaveBeenCalledWith(list.uid);

      // Pending marks are cleared
      expect(groceryListStore.isPendingUpsert(list.uid)).toBe(false);
      expect(groceryListStore.isPendingDelete(list.uid)).toBe(false);
    });

    it("throws when flush fails in delete branch; delete, resourceListChanged, notifySync not called; clearPending called", async () => {
      const list = makeGroceryList({ deleted: false });
      const deletedList = { ...list, deleted: true };
      const groceryListStore = new GroceryListStore();
      const deleteSpy = vi.spyOn(groceryListStore, "delete");
      const clearPendingSpy = vi.spyOn(groceryListStore, "clearPending");

      const mockPutGroceryList = vi.fn();
      const mockRemoveGroceryList = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          groceryLists: { put: mockPutGroceryList, remove: mockRemoveGroceryList },
          flush: mockFlush,
        }),
        groceryListStore,
        notifier: stub.notifier,
      });
      seed(ctx, { groceryLists: [list] });

      await expect(commitGroceryList(ctx, deletedList)).rejects.toThrow("flush failed");

      // remove WAS called (before flush)
      expect(mockRemoveGroceryList).toHaveBeenCalledWith(deletedList.uid);

      // Subsequent steps did NOT run
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();

      // clearPending was called to roll back the pending mark
      expect(clearPendingSpy).toHaveBeenCalledWith(deletedList.uid);

      // Pending marks are cleared
      expect(groceryListStore.isPendingUpsert(deletedList.uid)).toBe(false);
      expect(groceryListStore.isPendingDelete(deletedList.uid)).toBe(false);

      // Item should still be in store
      expect(groceryListStore.get(list.uid)).toEqual(list);
    });
  });
});

describe("commitGroceryItemsBatch", () => {
  it("no-ops when items array is empty", async () => {
    const groceryItemStore = new GroceryItemStore();
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({ groceryItems: {}, flush: mockFlush }),
      groceryItemStore,
      notifier: stub.notifier,
    });
    await commitGroceryItemsBatch(ctx, []);
    expect(mockFlush).not.toHaveBeenCalled();
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(mockNotifySync).not.toHaveBeenCalled();
  });

  it("N items → exactly 1 flush, 1 resourceListChanged, 1 notifySync", async () => {
    const item1 = makeGroceryItem({ deleted: false });
    const item2 = makeGroceryItem({ deleted: false });
    const groceryItemStore = new GroceryItemStore();
    const setSpy = vi.spyOn(groceryItemStore, "set");
    const mockPut = vi.fn().mockResolvedValue(undefined);
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({ groceryItems: { put: mockPut, remove: mockRemove }, flush: mockFlush }),
      groceryItemStore,
      notifier: stub.notifier,
    });
    await commitGroceryItemsBatch(ctx, [item1, item2]);
    expect(mockPut).toHaveBeenCalledTimes(2);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(setSpy).toHaveBeenCalledTimes(2);
    expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);
    expect(mockNotifySync).toHaveBeenCalledTimes(1);
  });

  it("mixed upsert and delete in one batch", async () => {
    const upserted = makeGroceryItem({ deleted: false });
    const deleted = makeGroceryItem({ deleted: true });
    const groceryItemStore = new GroceryItemStore();
    const setSpy = vi.spyOn(groceryItemStore, "set");
    const deleteSpy = vi.spyOn(groceryItemStore, "delete");
    const mockPut = vi.fn().mockResolvedValue(undefined);
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({ groceryItems: { put: mockPut, remove: mockRemove }, flush: mockFlush }),
      groceryItemStore,
      notifier: stub.notifier,
    });
    seed(ctx, { groceryItems: [deleted] });
    await commitGroceryItemsBatch(ctx, [upserted, deleted]);
    expect(mockPut).toHaveBeenCalledWith(upserted);
    expect(mockRemove).toHaveBeenCalledWith(deleted.uid);
    expect(setSpy).toHaveBeenCalledWith(upserted);
    expect(deleteSpy).toHaveBeenCalledWith(deleted.uid);
    expect(mockFlush).toHaveBeenCalledTimes(1);
    expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);
    expect(mockNotifySync).toHaveBeenCalledTimes(1);
  });

  it("on cache flush failure, clears all pending marks before re-throwing", async () => {
    const item1 = makeGroceryItem({ deleted: false });
    const item2 = makeGroceryItem({ deleted: false });
    const groceryItemStore = new GroceryItemStore();
    const clearPendingSpy = vi.spyOn(groceryItemStore, "clearPending");
    const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({
        groceryItems: { put: vi.fn().mockResolvedValue(undefined), remove: vi.fn() },
        flush: mockFlush,
      }),
      groceryItemStore,
      notifier: stub.notifier,
    });
    await expect(commitGroceryItemsBatch(ctx, [item1, item2])).rejects.toThrow("flush failed");
    expect(clearPendingSpy).toHaveBeenCalledWith(item1.uid);
    expect(clearPendingSpy).toHaveBeenCalledWith(item2.uid);
    expect(groceryItemStore.isPendingUpsert(item1.uid)).toBe(false);
    expect(groceryItemStore.isPendingUpsert(item2.uid)).toBe(false);
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(mockNotifySync).not.toHaveBeenCalled();
  });

  it("on cache put failure, clears all pending marks and does not flush or notify", async () => {
    const item1 = makeGroceryItem({ deleted: false });
    const item2 = makeGroceryItem({ deleted: false });
    const groceryItemStore = new GroceryItemStore();
    const clearPendingSpy = vi.spyOn(groceryItemStore, "clearPending");
    const mockFlush = vi.fn().mockResolvedValue(undefined);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const stub = makeStubNotifier();
    const { server } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ notifySync: mockNotifySync }),
      cache: fromAny({
        groceryItems: {
          put: vi.fn().mockRejectedValue(new Error("disk full")),
          remove: vi.fn(),
        },
        flush: mockFlush,
      }),
      groceryItemStore,
      notifier: stub.notifier,
    });
    await expect(commitGroceryItemsBatch(ctx, [item1, item2])).rejects.toThrow("disk full");
    expect(clearPendingSpy).toHaveBeenCalledWith(item1.uid);
    expect(clearPendingSpy).toHaveBeenCalledWith(item2.uid);
    expect(groceryItemStore.isPendingUpsert(item1.uid)).toBe(false);
    expect(groceryItemStore.isPendingUpsert(item2.uid)).toBe(false);
    expect(mockFlush).not.toHaveBeenCalled();
    expect(stub.resourceListChanged).not.toHaveBeenCalled();
    expect(mockNotifySync).not.toHaveBeenCalled();
  });
});

describe("commitGroceryItem", () => {
  describe("upsert branch (deleted: false)", () => {
    it("calls markPendingUpsert, put, flush, set, resourceListChanged, notifySync in order", async () => {
      const item = makeGroceryItem({ deleted: false });
      const groceryItemStore = new GroceryItemStore();
      const setSpy = vi.spyOn(groceryItemStore, "set");
      const _deleteSpy = vi.spyOn(groceryItemStore, "delete");

      const mockPutGroceryItem = vi.fn();
      const mockRemoveGroceryItem = vi.fn();
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          groceryItems: { put: mockPutGroceryItem, remove: mockRemoveGroceryItem },
          flush: mockFlush,
        }),
        groceryItemStore,
        notifier: stub.notifier,
      });

      await commitGroceryItem(ctx, item);

      // Assert ordering via invocationCallOrder
      expect(mockPutGroceryItem.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(setSpy.mock.invocationCallOrder[0]!);
      expect(setSpy.mock.invocationCallOrder[0]).toBeLessThan(stub.resourceListChanged.mock.invocationCallOrder[0]!);
      expect(stub.resourceListChanged.mock.invocationCallOrder[0]).toBeLessThan(
        mockNotifySync.mock.invocationCallOrder[0]!,
      );

      // Assert resourceListChanged called exactly once
      expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);

      // Assert delete-branch was NOT called
      expect(mockRemoveGroceryItem).not.toHaveBeenCalled();
      expect(_deleteSpy).not.toHaveBeenCalled();

      // Assert set was called with the item
      expect(setSpy).toHaveBeenCalledWith(item);
    });
  });

  describe("delete branch (deleted: true)", () => {
    it("calls markPendingDelete, remove, flush, delete, resourceListChanged, notifySync in order", async () => {
      const item = makeGroceryItem({ deleted: false });
      const deletedItem = { ...item, deleted: true };
      const groceryItemStore = new GroceryItemStore();
      const _setSpy = vi.spyOn(groceryItemStore, "set");
      const deleteSpy = vi.spyOn(groceryItemStore, "delete");

      const mockPutGroceryItem = vi.fn();
      const mockRemoveGroceryItem = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockResolvedValue(undefined);
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          groceryItems: { put: mockPutGroceryItem, remove: mockRemoveGroceryItem },
          flush: mockFlush,
        }),
        groceryItemStore,
        notifier: stub.notifier,
      });
      seed(ctx, { groceryItems: [item] });

      await commitGroceryItem(ctx, deletedItem);

      // Assert ordering via invocationCallOrder
      expect(mockRemoveGroceryItem.mock.invocationCallOrder[0]).toBeLessThan(mockFlush.mock.invocationCallOrder[0]!);
      expect(mockFlush.mock.invocationCallOrder[0]).toBeLessThan(deleteSpy.mock.invocationCallOrder[0]!);
      expect(deleteSpy.mock.invocationCallOrder[0]).toBeLessThan(stub.resourceListChanged.mock.invocationCallOrder[0]!);
      expect(stub.resourceListChanged.mock.invocationCallOrder[0]).toBeLessThan(
        mockNotifySync.mock.invocationCallOrder[0]!,
      );

      // Assert resourceListChanged called exactly once
      expect(stub.resourceListChanged).toHaveBeenCalledTimes(1);

      // Assert upsert-branch was NOT called
      expect(mockPutGroceryItem).not.toHaveBeenCalled();
      expect(_setSpy).not.toHaveBeenCalled();

      // Assert delete was called with the uid
      expect(deleteSpy).toHaveBeenCalledWith(deletedItem.uid);
    });
  });

  describe("flush rejection propagation", () => {
    it("throws when flush fails in upsert branch; set, resourceListChanged, notifySync not called; clearPending called", async () => {
      const item = makeGroceryItem({ deleted: false });
      const groceryItemStore = new GroceryItemStore();
      const setSpy = vi.spyOn(groceryItemStore, "set");
      const clearPendingSpy = vi.spyOn(groceryItemStore, "clearPending");

      const mockPutGroceryItem = vi.fn();
      const mockRemoveGroceryItem = vi.fn();
      const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          groceryItems: { put: mockPutGroceryItem, remove: mockRemoveGroceryItem },
          flush: mockFlush,
        }),
        groceryItemStore,
        notifier: stub.notifier,
      });

      await expect(commitGroceryItem(ctx, item)).rejects.toThrow("flush failed");

      // put WAS called (before flush)
      expect(mockPutGroceryItem).toHaveBeenCalledWith(item);

      // Subsequent steps did NOT run
      expect(setSpy).not.toHaveBeenCalled();
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();

      // clearPending was called to roll back the pending mark
      expect(clearPendingSpy).toHaveBeenCalledWith(item.uid);

      // Pending marks are cleared
      expect(groceryItemStore.isPendingUpsert(item.uid)).toBe(false);
      expect(groceryItemStore.isPendingDelete(item.uid)).toBe(false);
    });

    it("throws when flush fails in delete branch; delete, resourceListChanged, notifySync not called; clearPending called", async () => {
      const item = makeGroceryItem({ deleted: false });
      const deletedItem = { ...item, deleted: true };
      const groceryItemStore = new GroceryItemStore();
      const deleteSpy = vi.spyOn(groceryItemStore, "delete");
      const clearPendingSpy = vi.spyOn(groceryItemStore, "clearPending");

      const mockPutGroceryItem = vi.fn();
      const mockRemoveGroceryItem = vi.fn().mockResolvedValue(undefined);
      const mockFlush = vi.fn().mockRejectedValue(new Error("flush failed"));
      const mockNotifySync = vi.fn().mockResolvedValue(undefined);
      const stub = makeStubNotifier();

      const { server } = makeTestServer();
      const ctx = makeCtx(new RecipeStore(), server, {
        client: fromAny({ notifySync: mockNotifySync }),
        cache: fromAny({
          groceryItems: { put: mockPutGroceryItem, remove: mockRemoveGroceryItem },
          flush: mockFlush,
        }),
        groceryItemStore,
        notifier: stub.notifier,
      });
      seed(ctx, { groceryItems: [item] });

      await expect(commitGroceryItem(ctx, deletedItem)).rejects.toThrow("flush failed");

      // remove WAS called (before flush)
      expect(mockRemoveGroceryItem).toHaveBeenCalledWith(deletedItem.uid);

      // Subsequent steps did NOT run
      expect(deleteSpy).not.toHaveBeenCalled();
      expect(stub.resourceListChanged).not.toHaveBeenCalled();
      expect(mockNotifySync).not.toHaveBeenCalled();

      // clearPending was called to roll back the pending mark
      expect(clearPendingSpy).toHaveBeenCalledWith(deletedItem.uid);

      // Pending marks are cleared
      expect(groceryItemStore.isPendingUpsert(deletedItem.uid)).toBe(false);
      expect(groceryItemStore.isPendingDelete(deletedItem.uid)).toBe(false);

      // Item should still be in store
      expect(groceryItemStore.get(item.uid)).toEqual(item);
    });
  });
});
