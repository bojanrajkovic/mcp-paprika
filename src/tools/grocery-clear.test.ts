import { fromAny } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SeedData } from "../../test/support/tool-test-utils.js";
import type { GroceryItemUid, GroceryListUid } from "../ids.js";

import { makeGroceryItem } from "../../test/cache/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../test/cache/__fixtures__/grocery-lists.js";
import { getText, makeCtx, makeStubNotifier, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerClearAllTool, registerClearPurchasedTool } from "./grocery-clear.js";

const WEEKLY_LIST = makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" });

describe("clear_purchased tool", () => {
  let mockSaveGroceryItems: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockRemoveGroceryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSaveGroceryItems = vi.fn().mockImplementation(async (items) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockRemoveGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);
  });

  // Builds a clear_purchased ctx with mocked client + cache. `seedOverrides` merges
  // over the synced baseline (the Weekly grocery list, no items);
  // pass `{ groceryItems: [...] }` to stage items, or omit keys for cold-store guard cases.
  function makeClearCtx(seedOverrides?: SeedData) {
    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
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
    seed(ctx, { groceryLists: [WEEKLY_LIST], groceryItems: [], ...seedOverrides });
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
    const { callTool, ctx } = makeClearCtx({ groceryItems: [purchasedItem1, purchasedItem2, unpurchasedItem] });

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
    expect(ctx.groceryItemStore.get(unpurchasedUid)).toBeDefined();
  });

  it("grocery-surface.AC3.7: returns informational message when no purchased items, saveGroceryItems NOT called", async () => {
    const unpurchasedItem = makeGroceryItem({
      uid: "ITEM-U1" as GroceryItemUid,
      ingredient: "Eggs",
      listUid: "LIST-1",
      purchased: false,
    });
    const { callTool } = makeClearCtx({ groceryItems: [unpurchasedItem] });

    const result = await callTool("clear_purchased", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no purchased items to clear");
    expect(text).toContain('"Weekly"');
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-not-synced guard: returns sync message when grocery stores not loaded", async () => {
    // grocery stores left cold (keys omitted → hasSynced false) so the grocery guard fires.
    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
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
    // No seed — stores are cold
    registerClearPurchasedTool(server, ctx);

    const result = await callTool("clear_purchased", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("grocery data is not yet synced");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("invalid list UID returns not-found message without touching saves", async () => {
    const { callTool } = makeClearCtx();

    const result = await callTool("clear_purchased", { listUid: "NEVER-EXISTED" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });
});

describe("clear_all tool", () => {
  let mockSaveGroceryItems: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockRemoveGroceryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockSaveGroceryItems = vi.fn().mockImplementation(async (items) => items);
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockRemoveGroceryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);
  });

  // Builds a clear_all ctx with mocked client + cache. `seedOverrides` merges
  // over the synced baseline (the Weekly grocery list, no items);
  // pass `{ groceryItems: [...] }` to stage items, or omit keys for cold-store guard cases.
  function makeClearAllCtx(seedOverrides?: SeedData) {
    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
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
    seed(ctx, { groceryLists: [WEEKLY_LIST], groceryItems: [], ...seedOverrides });
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
    const { callTool } = makeClearAllCtx({ groceryItems: items });

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
    const { callTool } = makeClearAllCtx();

    const result = await callTool("clear_all", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no items to clear");
    expect(text).toContain('"Weekly"');
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-not-synced guard: returns sync message when grocery stores not loaded", async () => {
    // grocery stores left cold (keys omitted → hasSynced false) so the grocery guard fires.
    const { notifier } = makeStubNotifier();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
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
    // No seed — stores are cold
    registerClearAllTool(server, ctx);

    const result = await callTool("clear_all", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("grocery data is not yet synced");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });

  it("invalid list UID returns not-found message without touching saves", async () => {
    const { callTool } = makeClearAllCtx();

    const result = await callTool("clear_all", { listUid: "NEVER-EXISTED" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
    expect(mockSaveGroceryItems).not.toHaveBeenCalled();
  });
});
