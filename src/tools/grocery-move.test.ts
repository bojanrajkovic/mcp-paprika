import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { GroceryListStore } from "../cache/grocery-list-store.js";
import { GroceryItemStore } from "../cache/grocery-item-store.js";
import { makeGroceryList } from "../cache/__fixtures__/grocery-lists.js";
import { makeGroceryItem } from "../cache/__fixtures__/grocery-items.js";
import { registerMoveToPantryTool } from "./grocery-move.js";
import { makeTestServer, makeCtx, getText, makeStubNotifier } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCacheRoot } from "../cache/disk/root.js";
import type { GroceryListUid, GroceryItemUid, PantryItemUid } from "../paprika/types.js";

describe("move_to_pantry tool", () => {
  let pantryStore: PantryStore;
  let groceryListStore: GroceryListStore;
  let groceryItemStore: GroceryItemStore;

  let mockSavePantryItems: ReturnType<typeof vi.fn>;
  let mockSaveGroceryItems: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPutPantryItem: ReturnType<typeof vi.fn>;
  let mockRemoveGroceryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    pantryStore = new PantryStore();
    groceryListStore = new GroceryListStore();
    groceryItemStore = new GroceryItemStore();

    mockSavePantryItems = vi.fn().mockImplementation(async (items) => items);
    mockSaveGroceryItems = vi.fn().mockImplementation(async (items) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPutPantryItem = vi.fn().mockResolvedValue(undefined);
    mockRemoveGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);

    pantryStore.load([]);
    groceryListStore.load([makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" })]);
    groceryItemStore.load([]);
  });

  function makeMoveCtx() {
    const { notifier, resourceListChanged } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      pantryStore,
      groceryListStore,
      groceryItemStore,
      client: {
        savePantryItems: mockSavePantryItems,
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      } as unknown as PaprikaClient,
      cache: {
        pantry: { put: mockPutPantryItem },
        groceryItems: { remove: mockRemoveGroceryItem },
        flush: mockFlush,
      } as unknown as DiskCacheRoot,
      notifier,
    });
    registerMoveToPantryTool(server, ctx);
    return { server, callTool, notifier, resourceListChanged, ctx };
  }

  it("grocery-surface.AC3.1: single UID creates pantry item then deletes grocery item", async () => {
    const item = makeGroceryItem({
      uid: "ITEM-1" as GroceryItemUid,
      ingredient: "Apples",
      aisle: "Produce",
      aisleUid: "AISLE-1",
      listUid: "LIST-1",
    });
    groceryItemStore.load([item]);

    const { callTool } = makeMoveCtx();

    const result = await callTool("move_to_pantry", { uids: ["ITEM-1"] });
    const text = getText(result);

    // Response mentions ingredient
    expect(text).toContain("Apples");
    expect(text.toLowerCase()).toContain("moved");

    // Pantry save called with correct fields
    expect(mockSavePantryItems).toHaveBeenCalledOnce();
    const savedPantryItems = mockSavePantryItems.mock.calls[0]?.[0] as Array<{
      ingredient: string;
      aisle: string;
      aisleUid: string;
      quantity: string;
      deleted: boolean;
      inStock: boolean;
      expirationDate: null;
      hasExpiration: boolean;
    }>;
    expect(savedPantryItems).toHaveLength(1);
    const pantryItem = savedPantryItems[0];
    expect(pantryItem?.ingredient).toBe("Apples");
    expect(pantryItem?.aisle).toBe("Produce");
    expect(pantryItem?.aisleUid).toBe("AISLE-1");
    expect(pantryItem?.quantity).toBe("");
    expect(pantryItem?.deleted).toBe(false);
    expect(pantryItem?.inStock).toBe(true);
    expect(pantryItem?.expirationDate).toBeNull();
    expect(pantryItem?.hasExpiration).toBe(false);

    // purchaseDate is today in Paprika wire format
    const purchaseDateField = (savedPantryItems[0] as Record<string, unknown>)["purchaseDate"];
    expect(typeof purchaseDateField).toBe("string");
    expect(purchaseDateField).toMatch(/^\d{4}-\d{2}-\d{2} 00:00:00$/);

    // Grocery delete called with deleted:true
    expect(mockSaveGroceryItems).toHaveBeenCalledOnce();
    const savedGroceryItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{
      uid: string;
      deleted: boolean;
    }>;
    expect(savedGroceryItems).toHaveLength(1);
    const groceryItem = savedGroceryItems[0];
    expect(groceryItem?.uid).toBe("ITEM-1");
    expect(groceryItem?.deleted).toBe(true);

    // Create-first ordering: pantry save must be called before grocery delete
    const pantryCallOrder = mockSavePantryItems.mock.invocationCallOrder[0];
    const groceryCallOrder = mockSaveGroceryItems.mock.invocationCallOrder[0];
    expect(pantryCallOrder).toBeDefined();
    expect(groceryCallOrder).toBeDefined();
    expect(pantryCallOrder!).toBeLessThan(groceryCallOrder!);

    // Pantry commit path: put called (upsert branch of commitPantryItem)
    expect(mockPutPantryItem).toHaveBeenCalledOnce();
    // Grocery commit path: remove called (delete branch of commitGroceryItem)
    expect(mockRemoveGroceryItem).toHaveBeenCalledOnce();
  });

  it("grocery-surface.AC3.2: batch of 3 UIDs calls savePantryItems once then saveGroceryItems once (create-first)", async () => {
    const items = [
      makeGroceryItem({ uid: "BATCH-1" as GroceryItemUid, ingredient: "Apples", listUid: "LIST-1" }),
      makeGroceryItem({ uid: "BATCH-2" as GroceryItemUid, ingredient: "Milk", listUid: "LIST-1" }),
      makeGroceryItem({ uid: "BATCH-3" as GroceryItemUid, ingredient: "Eggs", listUid: "LIST-1" }),
    ];
    groceryItemStore.load(items);

    const { callTool } = makeMoveCtx();

    const result = await callTool("move_to_pantry", {
      uids: ["BATCH-1", "BATCH-2", "BATCH-3"],
    });
    const text = getText(result);
    expect(text.toLowerCase()).toContain("moved");

    // Single batch save for pantry
    expect(mockSavePantryItems).toHaveBeenCalledOnce();
    const savedPantryBatch = mockSavePantryItems.mock.calls[0]?.[0] as Array<unknown>;
    expect(savedPantryBatch).toHaveLength(3);

    // Single batch save for grocery delete
    expect(mockSaveGroceryItems).toHaveBeenCalledOnce();
    const savedGroceryBatch = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{ deleted: boolean }>;
    expect(savedGroceryBatch).toHaveLength(3);
    for (const gi of savedGroceryBatch) {
      expect(gi.deleted).toBe(true);
    }

    // Create-first ordering
    const pantryCallOrder = mockSavePantryItems.mock.invocationCallOrder[0];
    const groceryCallOrder = mockSaveGroceryItems.mock.invocationCallOrder[0];
    expect(pantryCallOrder!).toBeLessThan(groceryCallOrder!);

    // commitPantryItem called 3 times (put branch), then commitGroceryItem called 3 times (remove branch)
    expect(mockPutPantryItem).toHaveBeenCalledTimes(3);
    expect(mockRemoveGroceryItem).toHaveBeenCalledTimes(3);

    // All pantry puts must happen before any grocery removes (create-first at commit level)
    const pantryPutOrders = mockPutPantryItem.mock.invocationCallOrder;
    const groceryRemoveOrders = mockRemoveGroceryItem.mock.invocationCallOrder;
    const lastPantryPut = Math.max(...pantryPutOrders);
    const firstGroceryRemove = Math.min(...groceryRemoveOrders);
    expect(lastPantryPut).toBeLessThan(firstGroceryRemove);
  });

  it("grocery-surface.AC3.5: tombstoned UID returns already-deleted, neither save called", async () => {
    const item = makeGroceryItem({ uid: "TOMB-1" as GroceryItemUid, ingredient: "Milk" });
    groceryItemStore.load([item]);
    // Create tombstone by deleting after load
    groceryItemStore.delete("TOMB-1" as GroceryItemUid);

    const { callTool } = makeMoveCtx();

    const result = await callTool("move_to_pantry", { uids: ["TOMB-1"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("already deleted");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC3.6: partial failure returns structured message with created pantry UIDs", async () => {
    const item = makeGroceryItem({
      uid: "PFAIL-1" as GroceryItemUid,
      ingredient: "Butter",
      listUid: "LIST-1",
    });
    groceryItemStore.load([item]);

    // Pantry save succeeds, grocery delete fails
    mockSaveGroceryItems.mockRejectedValue(new Error("network timeout"));

    const { callTool } = makeMoveCtx();

    const result = await callTool("move_to_pantry", { uids: ["PFAIL-1"] });
    const text = getText(result);

    // Response mentions partial failure
    expect(text.toLowerCase()).toContain("partial failure");
    // Mentions that pantry items were created
    expect(text.toLowerCase()).toContain("pantry item(s) were created");
    // Mentions the failure reason
    expect(text.toLowerCase()).toContain("network timeout");
    // Pantry UIDs are included (the UID from savePantryItems response)
    // mockSavePantryItems returns the same items passed in, so UID is random UUID
    // We just check the text contains "uids:" mention
    expect(text.toLowerCase()).toContain("uids:");

    // Pantry save was called and succeeded
    expect(mockSavePantryItems).toHaveBeenCalledOnce();
    // Grocery save was called and failed
    expect(mockSaveGroceryItems).toHaveBeenCalledOnce();
    // Pantry commit happened (put called)
    expect(mockPutPantryItem).toHaveBeenCalledOnce();
    // Grocery commit did NOT happen (remove not called)
    expect(mockRemoveGroceryItem).not.toHaveBeenCalled();
  });

  it("pantry-not-synced guard: returns pantry sync message when pantryStore not loaded", async () => {
    // groceryListStore and groceryItemStore are loaded in beforeEach,
    // but we use a fresh pantryStore that has NOT been loaded
    const freshPantryStore = new PantryStore();

    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      pantryStore: freshPantryStore,
      groceryListStore,
      groceryItemStore,
      client: {
        savePantryItems: mockSavePantryItems,
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      } as unknown as PaprikaClient,
      cache: {
        pantry: { put: mockPutPantryItem },
        groceryItems: { remove: mockRemoveGroceryItem },
        flush: mockFlush,
      } as unknown as DiskCacheRoot,
      notifier,
    });
    registerMoveToPantryTool(server, ctx);

    const result = await callTool("move_to_pantry", { uids: ["ITEM-1"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("pantry is not yet synced");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-not-synced guard: returns grocery sync message when grocery stores not loaded", async () => {
    // Use fresh stores with no .load() called — grocery guard fires first
    const freshGroceryListStore = new GroceryListStore();
    const freshGroceryItemStore = new GroceryItemStore();

    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      pantryStore,
      groceryListStore: freshGroceryListStore,
      groceryItemStore: freshGroceryItemStore,
      client: {
        savePantryItems: mockSavePantryItems,
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      } as unknown as PaprikaClient,
      cache: {
        pantry: { put: mockPutPantryItem },
        groceryItems: { remove: mockRemoveGroceryItem },
        flush: mockFlush,
      } as unknown as DiskCacheRoot,
      notifier,
    });
    registerMoveToPantryTool(server, ctx);

    const result = await callTool("move_to_pantry", { uids: ["ITEM-1"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("grocery data is not yet synced");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("unknown UID returns not-found message without touching saves", async () => {
    groceryItemStore.load([]);

    const { callTool } = makeMoveCtx();

    const result = await callTool("move_to_pantry", { uids: ["NEVER-EXISTED"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery item found");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("duplicate UIDs are deduplicated — only one pantry item created per unique UID", async () => {
    const item = makeGroceryItem({
      uid: "DUP-1" as GroceryItemUid,
      ingredient: "Butter",
      listUid: "LIST-1",
    });
    groceryItemStore.load([item]);

    const { callTool } = makeMoveCtx();

    const result = await callTool("move_to_pantry", { uids: ["DUP-1", "DUP-1", "DUP-1"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("moved");
    expect(mockSavePantryItems).toHaveBeenCalledOnce();
    const savedPantry = mockSavePantryItems.mock.calls[0]?.[0] as Array<unknown>;
    expect(savedPantry).toHaveLength(1);
    expect(mockSaveGroceryItems).toHaveBeenCalledOnce();
    const savedGrocery = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<unknown>;
    expect(savedGrocery).toHaveLength(1);
  });

  it("pantry-create failure returns structured error without deleting grocery items", async () => {
    const item = makeGroceryItem({
      uid: "PFAIL-3" as GroceryItemUid,
      ingredient: "Chicken",
      listUid: "LIST-1",
    });
    groceryItemStore.load([item]);

    mockSavePantryItems.mockRejectedValue(new Error("pantry API down"));

    const { callTool } = makeMoveCtx();

    const result = await callTool("move_to_pantry", { uids: ["PFAIL-3"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("failed to create pantry items");
    expect(text.toLowerCase()).toContain("pantry api down");
    expect(text.toLowerCase()).toContain("no grocery items were deleted");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
    expect(mockRemoveGroceryItem).not.toHaveBeenCalled();
  });

  it("AC3.6: partial failure message includes the pantry UIDs returned by savePantryItems", async () => {
    const item = makeGroceryItem({
      uid: "PFAIL-2" as GroceryItemUid,
      ingredient: "Cheese",
      listUid: "LIST-1",
    });
    groceryItemStore.load([item]);

    // Override to return a specific UID we can assert on
    const knownPantryUid = "PANTRY-UID-KNOWN" as PantryItemUid;
    mockSavePantryItems.mockResolvedValueOnce([
      {
        uid: knownPantryUid,
        ingredient: "Cheese",
        aisle: "",
        aisleUid: "",
        quantity: "",
        expirationDate: null,
        hasExpiration: false,
        inStock: true,
        purchaseDate: "2026-01-01 00:00:00",
        notes: null,
        deleted: false,
      },
    ]);
    mockSaveGroceryItems.mockRejectedValue(new Error("server error"));

    const { callTool } = makeMoveCtx();

    const result = await callTool("move_to_pantry", { uids: ["PFAIL-2"] });
    const text = getText(result);

    expect(text).toContain("PANTRY-UID-KNOWN");
  });
});
