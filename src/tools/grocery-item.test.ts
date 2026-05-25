import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { GroceryListStore } from "../cache/grocery-list-store.js";
import { GroceryItemStore } from "../cache/grocery-item-store.js";
import { GroceryIngredientStore } from "../cache/grocery-ingredient-store.js";
import { AisleStore } from "../cache/aisle-store.js";
import { makeGroceryList } from "../cache/__fixtures__/grocery-lists.js";
import { makeGroceryItem } from "../cache/__fixtures__/grocery-items.js";
import { makeGroceryIngredient } from "../cache/__fixtures__/grocery-ingredients.js";
import { makeAisle } from "../cache/__fixtures__/aisles.js";
import {
  registerAddGroceryItemsTool,
  registerUpdateGroceryItemTool,
  registerDeleteGroceryItemTool,
} from "./grocery-item.js";
import { makeTestServer, makeCtx, getText, makeStubNotifier } from "./tool-test-utils.js";
import type { GroceryListUid, GroceryItemUid, AisleUid } from "../paprika/types.js";

describe("add_grocery_items tool", () => {
  let groceryListStore: GroceryListStore;
  let groceryItemStore: GroceryItemStore;
  let groceryIngredientStore: GroceryIngredientStore;
  let aisleStore: AisleStore;

  let mockSaveGroceryItems: ReturnType<typeof vi.fn>;
  let mockSaveGroceryIngredient: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPutGroceryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    groceryListStore = new GroceryListStore();
    groceryItemStore = new GroceryItemStore();
    groceryIngredientStore = new GroceryIngredientStore();
    aisleStore = new AisleStore();

    mockSaveGroceryItems = vi.fn().mockImplementation(async (items) => items);
    mockSaveGroceryIngredient = vi.fn().mockImplementation(async (ing) => ing);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPutGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);

    groceryListStore.load([makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" })]);
    groceryItemStore.load([]);
    aisleStore.load([makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" })]);
    groceryIngredientStore.load([makeGroceryIngredient({ name: "Butter", aisleUid: "AISLE-1" })]);
  });

  function makeAddCtx() {
    const { notifier, resourceListChanged } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore,
      groceryItemStore,
      groceryIngredientStore,
      aisleStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        saveGroceryIngredient: mockSaveGroceryIngredient,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem },
        groceryIngredients: { put: vi.fn() },
        flush: mockFlush,
      }),
      notifier,
    });
    registerAddGroceryItemsTool(server, ctx);
    return { server, callTool, notifier, resourceListChanged, ctx };
  }

  it("grocery-surface.AC2.1: single item with quantity creates name as 'quantity ingredient'", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Chicken", quantity: "2 lbs" }],
    });
    const text = getText(result);

    expect(text).toContain("Chicken");
    expect(mockSaveGroceryItems).toHaveBeenCalledOnce();

    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{
      name: string;
      ingredient: string;
      quantity: string;
    }>;
    expect(savedItems).toHaveLength(1);
    const item = savedItems[0];
    expect(item?.name).toBe("2 lbs Chicken");
    expect(item?.ingredient).toBe("Chicken");
    expect(item?.quantity).toBe("2 lbs");
  });

  it("grocery-surface.AC2.1: single item with empty quantity creates name as just ingredient", async () => {
    const { callTool } = makeAddCtx();

    await callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Butter" }],
    });

    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{ name: string; ingredient: string }>;
    expect(savedItems).toHaveLength(1);
    const item = savedItems[0];
    expect(item?.name).toBe("Butter");
    expect(item?.ingredient).toBe("Butter");
  });

  it("grocery-surface.AC2.2: batch of 3 items calls saveGroceryItems once with all 3", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [
        { ingredient: "Apples", quantity: "6" },
        { ingredient: "Milk", quantity: "1 gallon" },
        { ingredient: "Eggs", quantity: "1 dozen" },
      ],
    });
    const text = getText(result);

    expect(text).toContain("Apples");
    expect(text).toContain("Milk");
    expect(text).toContain("Eggs");

    // Single batch POST
    expect(mockSaveGroceryItems).toHaveBeenCalledOnce();
    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<unknown>;
    expect(savedItems).toHaveLength(3);

    // commitGroceryItem called once per item (mockPutGroceryItem = cache.groceryItems.put)
    expect(mockPutGroceryItem).toHaveBeenCalledTimes(3);
  });

  it("grocery-surface.AC2.3: auto-resolves aisle from ingredient catalog when aisle omitted", async () => {
    const { callTool } = makeAddCtx();

    // "Butter" is in the ingredient catalog with aisleUid "AISLE-1" → "Produce"
    await callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Butter" }],
    });

    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{
      aisle: string;
      aisleUid: string;
    }>;
    const item = savedItems[0];
    // Should have resolved aisle from catalog
    expect(item?.aisle).toBe("Produce");
    expect(item?.aisleUid).toBe("AISLE-1");

    // Should NOT call saveGroceryIngredient when no explicit aisle provided
    expect(mockSaveGroceryIngredient).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC2.3: uses empty aisle strings when ingredient not in catalog and aisle omitted", async () => {
    const { callTool } = makeAddCtx();

    // "Unknown Spice" is NOT in the ingredient catalog
    await callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Unknown Spice" }],
    });

    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{
      aisle: string;
      aisleUid: string;
    }>;
    const item = savedItems[0];
    expect(item?.aisle).toBe("");
    expect(item?.aisleUid).toBe("");
  });

  it("grocery-surface.AC2.4: explicit aisle uses ensureAisle and updates ingredient catalog", async () => {
    // "Butter" is already in catalog with "AISLE-1" (Produce)
    // Providing explicit aisle "Dairy" should:
    //   1. Call ensureAisle (create "Dairy" aisle since it doesn't exist)
    //   2. Update the catalog entry for "Butter" with new aisleUid
    const mockSaveAisle = vi.fn().mockImplementation(async (a) => a);
    // We need to inject saveAisle too since ensureAisle creates it
    const { notifier } = makeStubNotifier();
    const { server, callTool: callTool2 } = makeTestServer();
    aisleStore.load([makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" })]);
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore,
      groceryItemStore,
      groceryIngredientStore,
      aisleStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        saveGroceryIngredient: mockSaveGroceryIngredient,
        saveAisle: mockSaveAisle,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem },
        aisles: { put: vi.fn().mockResolvedValue(undefined) },
        flush: mockFlush,
      }),
      notifier,
    });
    registerAddGroceryItemsTool(server, ctx);

    await callTool2("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Butter", aisle: "Dairy" }],
    });

    // saveGroceryIngredient should be called to update the catalog entry
    expect(mockSaveGroceryIngredient).toHaveBeenCalledOnce();
    const savedIngredient = mockSaveGroceryIngredient.mock.calls[0]?.[0] as {
      name: string;
      aisleUid: string;
    };
    expect(savedIngredient?.name).toBe("Butter");
    // The aisleUid should be the new "Dairy" aisle's UID (not "AISLE-1")
    expect(savedIngredient?.aisleUid).not.toBe("AISLE-1");
  });

  it("grocery-surface.AC2.9: invalid listUid returns error without calling saveGroceryItems", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_grocery_items", {
      listUid: "NONEXISTENT",
      items: [{ ingredient: "Butter" }],
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not found");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC2.10: batch with empty ingredient rejects entire batch before API calls", async () => {
    const { callTool } = makeAddCtx();

    // An empty ingredient string should be rejected — all-or-nothing
    const result = await callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [
        { ingredient: "Apples" },
        { ingredient: "" }, // invalid
      ],
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("invalid");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("in-batch aisle inference: later item without aisle inherits from earlier item with explicit aisle", async () => {
    const { callTool } = makeAddCtx();

    await callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Milk", aisle: "Produce" }, { ingredient: "Milk" }],
    });

    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{ ingredient: string; aisle: string }>;
    expect(savedItems).toHaveLength(2);
    expect(savedItems[0]?.aisle).toBe("Produce");
    expect(savedItems[1]?.aisle).toBe("Produce");
  });

  it("duplicate ingredient with explicit aisle calls saveGroceryIngredient only once per ingredient", async () => {
    const mockSaveAisle = vi.fn().mockImplementation(async (a: unknown) => a);
    const { notifier } = makeStubNotifier();
    const { server, callTool: callTool2 } = makeTestServer();
    aisleStore.load([makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" })]);
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore,
      groceryItemStore,
      groceryIngredientStore,
      aisleStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        saveGroceryIngredient: mockSaveGroceryIngredient,
        saveAisle: mockSaveAisle,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem },
        aisles: { put: vi.fn() },
        flush: mockFlush,
      }),
      notifier,
    });
    registerAddGroceryItemsTool(server, ctx);

    await callTool2("add_grocery_items", {
      listUid: "LIST-1",
      items: [
        { ingredient: "Chicken", aisle: "Meat" },
        { ingredient: "Chicken", aisle: "Meat" },
        { ingredient: "Chicken", aisle: "Meat" },
      ],
    });

    const ingredientCalls = mockSaveGroceryIngredient.mock.calls.filter(
      (call: Array<unknown>) => (call[0] as { name: string }).name === "Chicken",
    );
    expect(ingredientCalls).toHaveLength(1);
  });

  it("cross-invocation: explicit aisle in first call is auto-resolved in second call via updated store", async () => {
    const mockSaveAisle = vi.fn().mockImplementation(async (a: unknown) => a);
    const { notifier } = makeStubNotifier();
    const { server, callTool: callTool3 } = makeTestServer();
    aisleStore.load([makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" })]);
    groceryIngredientStore.load([]);
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore,
      groceryItemStore,
      groceryIngredientStore,
      aisleStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        saveGroceryIngredient: mockSaveGroceryIngredient,
        saveAisle: mockSaveAisle,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem },
        aisles: { put: vi.fn() },
        flush: mockFlush,
      }),
      notifier,
    });
    registerAddGroceryItemsTool(server, ctx);

    await callTool3("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Tofu", aisle: "Deli" }],
    });

    mockSaveGroceryItems.mockClear();

    await callTool3("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Tofu" }],
    });

    const secondCallItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{ aisle: string }>;
    expect(secondCallItems).toHaveLength(1);
    expect(secondCallItems[0]?.aisle).toBe("Deli");
  });

  it("grocery-surface.AC2.12: sync-not-ready blocks add_grocery_items when stores not loaded", async () => {
    // Fresh stores with no .load() called
    const freshListStore = new GroceryListStore();
    const freshItemStore = new GroceryItemStore();

    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore: freshListStore,
      groceryItemStore: freshItemStore,
      groceryIngredientStore,
      aisleStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        saveGroceryIngredient: mockSaveGroceryIngredient,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    registerAddGroceryItemsTool(server, ctx);

    const result = await callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Butter" }],
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });
});

describe("update_grocery_item tool", () => {
  let groceryListStore: GroceryListStore;
  let groceryItemStore: GroceryItemStore;
  let groceryIngredientStore: GroceryIngredientStore;
  let aisleStore: AisleStore;

  let mockSaveGroceryItems: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPutGroceryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    groceryListStore = new GroceryListStore();
    groceryItemStore = new GroceryItemStore();
    groceryIngredientStore = new GroceryIngredientStore();
    aisleStore = new AisleStore();

    mockSaveGroceryItems = vi.fn().mockImplementation(async (items) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPutGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);

    groceryListStore.load([makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" })]);
    aisleStore.load([makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" })]);
    groceryIngredientStore.load([]);
  });

  function makeUpdateCtx() {
    const { notifier, resourceListChanged } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore,
      groceryItemStore,
      groceryIngredientStore,
      aisleStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    registerUpdateGroceryItemTool(server, ctx);
    return { server, callTool, notifier, resourceListChanged, ctx };
  }

  it("grocery-surface.AC2.5: partial merge updates only provided fields", async () => {
    const existingItem = makeGroceryItem({
      uid: "ITEM-1" as GroceryItemUid,
      ingredient: "Apples",
      quantity: "6",
      aisle: "Produce",
      aisleUid: "AISLE-1",
      listUid: "LIST-1",
      purchased: false,
      instruction: "get the green ones",
    });
    groceryItemStore.load([existingItem]);

    const { callTool } = makeUpdateCtx();

    const result = await callTool("update_grocery_item", {
      uid: "ITEM-1",
      quantity: "10",
    });
    const text = getText(result);
    expect(text).toContain("Apples");

    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{
      ingredient: string;
      quantity: string;
      aisle: string;
      aisleUid: string;
      purchased: boolean;
      instruction: string;
    }>;
    const saved = savedItems[0];

    // Only quantity changed
    expect(saved?.quantity).toBe("10");
    // All others unchanged from baseline
    expect(saved?.ingredient).toBe("Apples");
    expect(saved?.aisle).toBe("Produce");
    expect(saved?.aisleUid).toBe("AISLE-1");
    expect(saved?.purchased).toBe(false);
    expect(saved?.instruction).toBe("get the green ones");
  });

  it("grocery-surface.AC2.6: updating purchased toggles status to true", async () => {
    const existingItem = makeGroceryItem({
      uid: "ITEM-2" as GroceryItemUid,
      ingredient: "Milk",
      purchased: false,
    });
    groceryItemStore.load([existingItem]);

    const { callTool } = makeUpdateCtx();

    await callTool("update_grocery_item", {
      uid: "ITEM-2",
      purchased: true,
    });

    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{ purchased: boolean }>;
    expect(savedItems[0]?.purchased).toBe(true);
  });

  it("grocery-surface.AC2.7: name recalculated when quantity changes from empty to non-empty", async () => {
    const existingItem = makeGroceryItem({
      uid: "ITEM-3" as GroceryItemUid,
      ingredient: "Chicken",
      quantity: "",
      name: "Chicken",
    });
    groceryItemStore.load([existingItem]);

    const { callTool } = makeUpdateCtx();

    await callTool("update_grocery_item", {
      uid: "ITEM-3",
      quantity: "2 lbs",
    });

    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{ name: string; quantity: string }>;
    const saved = savedItems[0];
    expect(saved?.name).toBe("2 lbs Chicken");
    expect(saved?.quantity).toBe("2 lbs");
  });

  it("grocery-surface.AC2.7: name recalculated when quantity changes from non-empty to empty", async () => {
    const existingItem = makeGroceryItem({
      uid: "ITEM-4" as GroceryItemUid,
      ingredient: "Chicken",
      quantity: "2 lbs",
      name: "2 lbs Chicken",
    });
    groceryItemStore.load([existingItem]);

    const { callTool } = makeUpdateCtx();

    await callTool("update_grocery_item", {
      uid: "ITEM-4",
      quantity: "",
    });

    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{ name: string; quantity: string }>;
    const saved = savedItems[0];
    expect(saved?.name).toBe("Chicken");
    expect(saved?.quantity).toBe("");
  });

  it("grocery-surface.AC2.11: unknown UID returns error and does not call saveGroceryItems", async () => {
    groceryItemStore.load([]);
    const { callTool } = makeUpdateCtx();

    const result = await callTool("update_grocery_item", {
      uid: "NONEXISTENT-UID",
      quantity: "5",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery item found");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC2.12: sync-not-ready blocks update_grocery_item when stores not loaded", async () => {
    const freshListStore = new GroceryListStore();
    const freshItemStore = new GroceryItemStore();

    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore: freshListStore,
      groceryItemStore: freshItemStore,
      groceryIngredientStore,
      aisleStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    registerUpdateGroceryItemTool(server, ctx);

    const result = await callTool("update_grocery_item", {
      uid: "ITEM-1",
      quantity: "5",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });
});

describe("delete_grocery_item tool", () => {
  let groceryListStore: GroceryListStore;
  let groceryItemStore: GroceryItemStore;
  let groceryIngredientStore: GroceryIngredientStore;
  let aisleStore: AisleStore;

  let mockSaveGroceryItems: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPutGroceryItem: ReturnType<typeof vi.fn>;
  let mockRemoveGroceryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    groceryListStore = new GroceryListStore();
    groceryItemStore = new GroceryItemStore();
    groceryIngredientStore = new GroceryIngredientStore();
    aisleStore = new AisleStore();

    mockSaveGroceryItems = vi.fn().mockImplementation(async (items) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPutGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockRemoveGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);

    groceryListStore.load([makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" })]);
    groceryIngredientStore.load([]);
    aisleStore.load([]);
  });

  function makeDeleteCtx() {
    const { notifier, resourceListChanged } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore,
      groceryItemStore,
      groceryIngredientStore,
      aisleStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem, remove: mockRemoveGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    registerDeleteGroceryItemTool(server, ctx);
    return { server, callTool, notifier, resourceListChanged, ctx };
  }

  it("grocery-surface.AC2.8: delete existing item sets deleted:true and commits", async () => {
    const existingItem = makeGroceryItem({
      uid: "ITEM-DEL-1" as GroceryItemUid,
      ingredient: "Milk",
      listUid: "LIST-1",
      deleted: false,
    });
    groceryItemStore.load([existingItem]);

    const { callTool } = makeDeleteCtx();

    const result = await callTool("delete_grocery_item", {
      uid: "ITEM-DEL-1",
    });
    const text = getText(result);

    // Response should confirm deletion
    expect(text.toLowerCase()).toContain("deleted");
    expect(text).toContain("Milk");

    // saveGroceryItems called with deleted:true
    expect(mockSaveGroceryItems).toHaveBeenCalledOnce();
    const savedItems = mockSaveGroceryItems.mock.calls[0]?.[0] as Array<{
      uid: string;
      deleted: boolean;
    }>;
    expect(savedItems).toHaveLength(1);
    const saved = savedItems[0];
    expect(saved?.deleted).toBe(true);
    expect(saved?.uid).toBe("ITEM-DEL-1");

    // commit path: remove called (delete branch of commitGroceryItem)
    expect(mockRemoveGroceryItem).toHaveBeenCalledOnce();
  });

  it("grocery-surface.AC2.12: sync-not-ready blocks delete_grocery_item when stores not loaded", async () => {
    const freshListStore = new GroceryListStore();
    const freshItemStore = new GroceryItemStore();

    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      groceryListStore: freshListStore,
      groceryItemStore: freshItemStore,
      groceryIngredientStore,
      aisleStore,
      client: fromAny({
        saveGroceryItems: mockSaveGroceryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        groceryItems: { put: mockPutGroceryItem, remove: mockRemoveGroceryItem },
        flush: mockFlush,
      }),
      notifier,
    });
    registerDeleteGroceryItemTool(server, ctx);

    const result = await callTool("delete_grocery_item", { uid: "ITEM-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC2.13: delete a tombstoned UID returns already-deleted message", async () => {
    const existingItem = makeGroceryItem({
      uid: "ITEM-DEL-2" as GroceryItemUid,
      ingredient: "Eggs",
    });
    // Load item and then delete it to create a tombstone
    groceryItemStore.load([existingItem]);
    groceryItemStore.delete("ITEM-DEL-2" as GroceryItemUid);

    const { callTool } = makeDeleteCtx();

    const result = await callTool("delete_grocery_item", {
      uid: "ITEM-DEL-2",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("already deleted");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC2.13: delete a UID never in the store returns not-found message", async () => {
    groceryItemStore.load([]);

    const { callTool } = makeDeleteCtx();

    const result = await callTool("delete_grocery_item", {
      uid: "NEVER-EXISTED",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery item found");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });
});
