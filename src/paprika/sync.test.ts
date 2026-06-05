import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import type { DiskCache } from "../cache/disk-cache.js";

import { makeGroceryList } from "../../test/domains/grocery/__fixtures__/grocery-lists.js";
import { GroceryListStore } from "../domains/grocery/grocery-list/store.js";
import { SILENT_LOG } from "../utils/log.js";
import { syncReplaceAllEntity } from "./sync.js";

describe("syncReplaceAllEntity", () => {
  type GList = ReturnType<typeof makeGroceryList>;

  function makeCache(initial: ReadonlyArray<GList> = []) {
    const getAll = vi.fn().mockResolvedValue(initial);
    const put = vi.fn().mockResolvedValue(undefined);
    const remove = vi.fn().mockResolvedValue(undefined);
    const cache: Pick<DiskCache<GList>, "getAll" | "put" | "remove"> = fromAny({ getAll, put, remove });
    return { cache, getAll, put, remove };
  }

  function listsEqual(a: ReturnType<typeof makeGroceryList>, b: ReturnType<typeof makeGroceryList>): boolean {
    return a.uid === b.uid && a.name === b.name && a.deleted === b.deleted;
  }

  it("returns empty changes when fetch and cache are both empty", async () => {
    const store = new GroceryListStore();
    const { cache } = makeCache([]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
    expect(result.removedUids).toHaveLength(0);
  });

  it("returns added for UIDs present in fetch but not in cache", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    const { cache } = makeCache([]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [list],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(result.added).toHaveLength(1);
    expect(result.added[0]?.uid).toBe(list.uid);
    expect(result.updated).toHaveLength(0);
    expect(result.removedUids).toHaveLength(0);
  });

  it("returns updated for UIDs in both fetch and cache where equals returns false", async () => {
    const list = makeGroceryList({ name: "Old Name" });
    const updated = { ...list, name: "New Name" };
    const store = new GroceryListStore();
    const { cache } = makeCache([list]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [updated],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0]?.name).toBe("New Name");
    expect(result.removedUids).toHaveLength(0);
  });

  it("returns removedUids and calls cache.remove for UIDs in cache but not in effective", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    const { cache, remove } = makeCache([list]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(result.removedUids).toHaveLength(1);
    expect(result.removedUids[0]).toBe(list.uid);
    expect(remove).toHaveBeenCalledWith(list.uid);
    expect(result.added).toHaveLength(0);
    expect(result.updated).toHaveLength(0);
  });

  it("excludes pending-upsert UIDs from incoming and splices them back from cache", async () => {
    const list = makeGroceryList({ name: "Local (pending)" });
    const serverVersion = { ...list, name: "Server (stale)" };
    const store = new GroceryListStore();
    store.markPendingUpsert(list.uid);
    const { cache } = makeCache([list]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [serverVersion],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    // The local pending version must survive
    expect(store.get(list.uid)?.name).toBe("Local (pending)");
    // UID is not in removedUids (spliced back from cache)
    expect(result.removedUids).not.toContain(list.uid);
    // Not in added (was already in cache)
    expect(result.added.map((l) => l.uid)).not.toContain(list.uid);
  });

  it("excludes pending-delete UIDs from incoming", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    store.load([list]);
    store.markPendingDelete(list.uid);
    const { cache } = makeCache([]);
    const result = await syncReplaceAllEntity({
      fetch: async () => [list],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    // Pending-delete UID was excluded from effective — not re-loaded
    expect(store.get(list.uid)).toBeUndefined();
    expect(result.added.map((l) => l.uid)).not.toContain(list.uid);
  });

  it("clears pending-upsert when rawIncoming equals the cached snapshot", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    store.markPendingUpsert(list.uid);
    const { cache } = makeCache([list]);
    await syncReplaceAllEntity({
      fetch: async () => [list], // server caught up — same content
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(store.isPendingUpsert(list.uid)).toBe(false);
  });

  it("does NOT clear pending-upsert when rawIncoming content differs from cached snapshot", async () => {
    const list = makeGroceryList({ name: "Local" });
    const staleServer = { ...list, name: "Old server version" };
    const store = new GroceryListStore();
    store.markPendingUpsert(list.uid);
    const { cache } = makeCache([list]);
    await syncReplaceAllEntity({
      fetch: async () => [staleServer],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
    });
    expect(store.isPendingUpsert(list.uid)).toBe(true);
  });

  it("calls afterLoad between store.load and cache.put loop", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    const loadSpy = vi.spyOn(store, "load");
    const { cache, put } = makeCache([]);
    const afterLoadOrder: Array<string> = [];
    loadSpy.mockImplementation((...args) => {
      afterLoadOrder.push("load");
      return GroceryListStore.prototype.load.call(store, ...args);
    });
    put.mockImplementation(async () => {
      afterLoadOrder.push("put");
    });
    const afterLoad = vi.fn(() => {
      afterLoadOrder.push("afterLoad");
    });
    await syncReplaceAllEntity({
      fetch: async () => [list],
      cache,
      store,
      equals: listsEqual,
      label: "grocery lists",
      log: SILENT_LOG,
      afterLoad,
    });
    const loadIdx = afterLoadOrder.indexOf("load");
    const afterLoadIdx = afterLoadOrder.indexOf("afterLoad");
    const putIdx = afterLoadOrder.indexOf("put");
    expect(loadIdx).toBeLessThan(afterLoadIdx);
    expect(afterLoadIdx).toBeLessThan(putIdx);
  });

  it("propagates errors from fetch", async () => {
    const store = new GroceryListStore();
    const { cache } = makeCache([]);
    await expect(
      syncReplaceAllEntity({
        fetch: async () => {
          throw new Error("network error");
        },
        cache,
        store,
        equals: listsEqual,
        label: "grocery lists",
        log: SILENT_LOG,
      }),
    ).rejects.toThrow("network error");
  });

  it("propagates errors from cache.getAll", async () => {
    const list = makeGroceryList();
    const store = new GroceryListStore();
    const cache: Pick<DiskCache<GList>, "getAll" | "put" | "remove"> = fromAny({
      getAll: vi.fn().mockRejectedValue(new Error("disk error")),
      put: vi.fn(),
      remove: vi.fn(),
    });
    await expect(
      syncReplaceAllEntity({
        fetch: async () => [list],
        cache,
        store,
        equals: listsEqual,
        label: "grocery lists",
        log: SILENT_LOG,
      }),
    ).rejects.toThrow("disk error");
  });
});
