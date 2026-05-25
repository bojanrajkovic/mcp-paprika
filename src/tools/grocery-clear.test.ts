import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { GroceryListStore } from "../cache/grocery-list-store.js";
import { GroceryItemStore } from "../cache/grocery-item-store.js";
import { makeGroceryList } from "../cache/__fixtures__/grocery-lists.js";
import { makeGroceryItem } from "../cache/__fixtures__/grocery-items.js";
import { registerClearPurchasedTool, registerClearAllTool } from "./grocery-clear.js";
import { makeTestServer, makeCtx, getText, makeStubNotifier } from "./tool-test-utils.js";
import type { GroceryListUid, GroceryItemUid } from "../paprika/types.js";

describe("clear_purchased tool", () => {
  let groceryListStore: GroceryListStore;
  let groceryItemStore: GroceryItemStore;

  let mockSaveGroceryItems: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockRemoveGroceryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    groceryListStore = new GroceryListStore();
    groceryItemStore = new GroceryItemStore();

    mockSaveGroceryItems = vi.fn().mockImplementation(async (items) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockRemoveGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);

    groceryListStore.load([makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" })]);
    groceryItemStore.load([]);
  });

  function makeClearCtx() {
    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore,
      groceryItemStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { remove: mockRemoveGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    registerClearPurchasedTool(server, ctx);
    return { server, callTool, notifier, ctx };
  }

  it("grocery-surface.AC3.3: clears only purchased items, leaving unpurchased intact", async () => {
    const purchasedItem1 = makeGroceryItem({
      uid: "ITEM-P1" as GroceryItemUid,
      ingredient: "Apples",
      listUid: "LIST-1",
      purchased: true,
    });
    const purchasedItem2 = makeGroceryItem({
      uid: "ITEM-P2" as GroceryItemUid,
      ingredient: "Milk",
      listUid: "LIST-1",
      purchased: true,
    });
    const unpurchasedItem = makeGroceryItem({
      uid: "ITEM-U1" as GroceryItemUid,
      ingredient: "Eggs",
      listUid: "LIST-1",
      purchased: false,
    });
    groceryItemStore.load([purchasedItem1, purchasedItem2, unpurchasedItem]);

    const { callTool } = makeClearCtx();

    const result = await callTool("clear_purchased", { listUid: "LIST-1" });
    const text = getText(result);

    // Response mentions how many were cleared
    expect(text).toContain("2");
    expect(text.toLowerCase()).toContain("cleared");
    expect(text).toContain('"Weekly"');

    // saveGroceryItems called with only the 2 purchased items, both deleted: true
    expect(mockSaveGroceryItems).toHaveBeenCalledOnce();
    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{ uid: string; deleted: boolean }>;
    expect(savedItems).toHaveLength(2);
    const savedUids = savedItems.map((i) => i.uid).sort();
    expect(savedUids).toEqual(["ITEM-P1", "ITEM-P2"].sort());
    for (const item of savedItems) {
      expect(item.deleted).toBe(true);
    }

    // commitGroceryItem called twice (remove branch)
    expect(mockRemoveGroceryItem).toHaveBeenCalledTimes(2);

    // Unpurchased item remains in store
    const unpurchasedUid = "ITEM-U1" as GroceryItemUid;
    expect(groceryItemStore.get(unpurchasedUid)).toBeDefined();
  });

  it("grocery-surface.AC3.7: returns informational message when no purchased items, saveGroceryItems NOT called", async () => {
    const unpurchasedItem = makeGroceryItem({
      uid: "ITEM-U1" as GroceryItemUid,
      ingredient: "Eggs",
      listUid: "LIST-1",
      purchased: false,
    });
    groceryItemStore.load([unpurchasedItem]);

    const { callTool } = makeClearCtx();

    const result = await callTool("clear_purchased", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no purchased items to clear");
    expect(text).toContain('"Weekly"');
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-not-synced guard: returns sync message when grocery stores not loaded", async () => {
    const freshGroceryListStore = new GroceryListStore();
    const freshGroceryItemStore = new GroceryItemStore();

    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore: freshGroceryListStore,
      groceryItemStore: freshGroceryItemStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { remove: mockRemoveGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    registerClearPurchasedTool(server, ctx);

    const result = await callTool("clear_purchased", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("grocery data is not yet synced");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("invalid list UID returns not-found message without touching saves", async () => {
    groceryItemStore.load([]);

    const { callTool } = makeClearCtx();

    const result = await callTool("clear_purchased", { listUid: "NEVER-EXISTED" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });
});

describe("clear_all tool", () => {
  let groceryListStore: GroceryListStore;
  let groceryItemStore: GroceryItemStore;

  let mockSaveGroceryItems: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockRemoveGroceryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    groceryListStore = new GroceryListStore();
    groceryItemStore = new GroceryItemStore();

    mockSaveGroceryItems = vi.fn().mockImplementation(async (items) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockRemoveGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);

    groceryListStore.load([makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" })]);
    groceryItemStore.load([]);
  });

  function makeClearAllCtx() {
    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore,
      groceryItemStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { remove: mockRemoveGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    registerClearAllTool(server, ctx);
    return { server, callTool, notifier, ctx };
  }

  it("grocery-surface.AC3.4: clears all items (purchased and unpurchased) via single batch POST", async () => {
    const items = [
      makeGroceryItem({
        uid: "ITEM-1" as GroceryItemUid,
        ingredient: "Apples",
        listUid: "LIST-1",
        purchased: true,
      }),
      makeGroceryItem({
        uid: "ITEM-2" as GroceryItemUid,
        ingredient: "Milk",
        listUid: "LIST-1",
        purchased: false,
      }),
      makeGroceryItem({
        uid: "ITEM-3" as GroceryItemUid,
        ingredient: "Eggs",
        listUid: "LIST-1",
        purchased: true,
      }),
    ];
    groceryItemStore.load(items);

    const { callTool } = makeClearAllCtx();

    const result = await callTool("clear_all", { listUid: "LIST-1" });
    const text = getText(result);

    // Response mentions count and list name
    expect(text).toContain("3");
    expect(text.toLowerCase()).toContain("cleared");
    expect(text).toContain('"Weekly"');

    // Single batch POST with all 3 items, all deleted: true
    expect(mockSaveGroceryItems).toHaveBeenCalledOnce();
    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{ uid: string; deleted: boolean }>;
    expect(savedItems).toHaveLength(3);
    for (const item of savedItems) {
      expect(item.deleted).toBe(true);
    }

    // commitGroceryItem called 3 times (remove branch)
    expect(mockRemoveGroceryItem).toHaveBeenCalledTimes(3);
  });

  it("grocery-surface.AC3.8: empty list returns informational message, saveGroceryItems NOT called", async () => {
    groceryItemStore.load([]);

    const { callTool } = makeClearAllCtx();

    const result = await callTool("clear_all", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no items to clear");
    expect(text).toContain('"Weekly"');
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-not-synced guard: returns sync message when grocery stores not loaded", async () => {
    const freshGroceryListStore = new GroceryListStore();
    const freshGroceryItemStore = new GroceryItemStore();

    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore: freshGroceryListStore,
      groceryItemStore: freshGroceryItemStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { remove: mockRemoveGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    registerClearAllTool(server, ctx);

    const result = await callTool("clear_all", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("grocery data is not yet synced");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("invalid list UID returns not-found message without touching saves", async () => {
    groceryItemStore.load([]);

    const { callTool } = makeClearAllCtx();

    const result = await callTool("clear_all", { listUid: "NEVER-EXISTED" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });
});
