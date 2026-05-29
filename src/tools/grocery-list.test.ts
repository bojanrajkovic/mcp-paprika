import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { GroceryListStore } from "../cache/grocery-list-store.js";
import { GroceryItemStore } from "../cache/grocery-item-store.js";
import { makeGroceryList } from "../cache/__fixtures__/grocery-lists.js";
import { makeGroceryItem } from "../cache/__fixtures__/grocery-items.js";
import { makeTestServer, makeCtx, getText, makeStubNotifier } from "./tool-test-utils.js";
import {
  registerListGroceryListsTool,
  registerReadGroceryListTool,
  registerCreateGroceryListTool,
  registerRenameGroceryListTool,
  registerDeleteGroceryListTool,
} from "./grocery-list.js";

describe("list_grocery_lists tool", () => {
  it("grocery-surface.AC1.9: returns sync-not-ready message when stores not loaded", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    // DO NOT call .load() on either store

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.1: returns empty message when no lists exist", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    expect(text).toBe("No grocery lists found.");
  });

  it("grocery-surface.AC1.1: returns list names, UIDs, and item counts", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Costco Run" });

    const item1 = makeGroceryItem({ listUid: listA.uid });
    const item2 = makeGroceryItem({ listUid: listA.uid });
    const item3 = makeGroceryItem({ listUid: listB.uid });

    groceryListStore.load([listA, listB]);
    groceryItemStore.load([item1, item2, item3]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    // Header mentions 2 lists
    expect(text).toContain("You have 2 grocery list(s)");

    // Both list names appear
    expect(text).toContain("Weekly Shopping");
    expect(text).toContain("Costco Run");

    // UIDs appear
    expect(text).toContain(listA.uid);
    expect(text).toContain(listB.uid);

    // Item counts appear
    expect(text).toContain("2 item(s)");
    expect(text).toContain("1 item(s)");
  });

  it("grocery-surface.AC1.1: sorts lists alphabetically by name", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const listZ = makeGroceryList({ name: "Zebra Market" });
    const listA = makeGroceryList({ name: "Aldi Trip" });
    const listM = makeGroceryList({ name: "Monthly Stock" });

    groceryListStore.load([listZ, listA, listM]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    const aldiIdx = text.indexOf("Aldi Trip");
    const monthlyIdx = text.indexOf("Monthly Stock");
    const zebraIdx = text.indexOf("Zebra Market");

    expect(aldiIdx).toBeGreaterThan(-1);
    expect(monthlyIdx).toBeGreaterThan(-1);
    expect(zebraIdx).toBeGreaterThan(-1);
    expect(aldiIdx).toBeLessThan(monthlyIdx);
    expect(monthlyIdx).toBeLessThan(zebraIdx);
  });
});

describe("read_grocery_list tool", () => {
  it("grocery-surface.AC1.9: returns sync-not-ready message when stores not loaded", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    // DO NOT call .load() on either store

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { uid: "some-uid" } });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.2: returns not-found when UID does not match any list", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { uid: "nonexistent-uid" } });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
  });

  it("grocery-surface.AC1.2: returns list metadata and items when fetched by UID", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item1 = makeGroceryItem({ listUid: list.uid, ingredient: "Apples" });
    const item2 = makeGroceryItem({ listUid: list.uid, ingredient: "Milk" });

    groceryListStore.load([list]);
    groceryItemStore.load([item1, item2]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { uid: list.uid } });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
    expect(text).toContain("Apples");
    expect(text).toContain("Milk");
  });

  it("grocery-surface.AC1.3: resolves by exact name match", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { name: "Weekly Shopping" } });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("grocery-surface.AC1.3: resolves by starts-with name match", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { name: "Weekly" } });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("grocery-surface.AC1.3: resolves by contains name match", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { name: "Shopping" } });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("grocery-surface.AC1.3: returns not-found when name does not match any list", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([makeGroceryList({ name: "Weekly Shopping" })]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { name: "Completely Different" } });
    const text = getText(result);

    // #142: the no-match wording is normalized to the plural form shared by
    // read_recipe / get_pantry_item via the consolidated formatLookupOutcome.
    expect(text.toLowerCase()).toContain("no grocery lists found matching");
  });

  it("grocery-surface.AC1.3: returns disambiguation when multiple lists match the same tier", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();

    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Weekly Costco" });

    groceryListStore.load([listA, listB]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, { groceryListStore, groceryItemStore });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { name: "Weekly" } });
    const text = getText(result);

    expect(text).toContain("Multiple grocery lists match");
    expect(text).toContain(listA.uid);
    expect(text).toContain(listB.uid);
    expect(text).toContain("Please re-invoke with a specific uid");
  });
});

// Helper to build write-tool ctx with mocked client and cache
function makeWriteToolCtx(
  groceryListStore: GroceryListStore,
  groceryItemStore: GroceryItemStore,
  server: ReturnType<typeof makeTestServer>["server"],
) {
  const mockSaveGroceryList = vi.fn().mockImplementation(async (list: unknown) => list);
  const mockNotifySync = vi.fn().mockResolvedValue(undefined);
  const mockPutGroceryList = vi.fn();
  const mockRemoveGroceryList = vi.fn();
  const mockFlush = vi.fn().mockResolvedValue(undefined);
  const { notifier, resourceListChanged } = makeStubNotifier();

  const ctx = makeCtx(new RecipeStore(), server, {
    groceryListStore,
    groceryItemStore,
    client: fromAny({
      saveGroceryList: mockSaveGroceryList,
      notifySync: mockNotifySync,
    }),
    cache: fromAny({
      groceryLists: { put: mockPutGroceryList, remove: mockRemoveGroceryList },
      flush: mockFlush,
    }),
    notifier,
  });

  return {
    ctx,
    mockSaveGroceryList,
    mockNotifySync,
    mockPutGroceryList,
    mockRemoveGroceryList,
    mockFlush,
    resourceListChanged,
  };
}

describe("create_grocery_list tool", () => {
  it("grocery-surface.AC1.9: returns sync-not-ready message when stores not loaded", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    // DO NOT call .load() on either store

    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerCreateGroceryListTool(server, ctx);

    const result = await callTool("create_grocery_list", { name: "Weekly Shopping" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.4: creates list with uppercase UUID and correct defaults", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList, resourceListChanged } = makeWriteToolCtx(
      groceryListStore,
      groceryItemStore,
      server,
    );
    registerCreateGroceryListTool(server, ctx);

    const result = await callTool("create_grocery_list", { name: "Weekly Shopping" });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(mockSaveGroceryList).toHaveBeenCalledOnce();
    const savedArg = mockSaveGroceryList.mock.calls[0]![0] as Record<string, unknown>;
    expect(savedArg["name"]).toBe("Weekly Shopping");
    expect(savedArg["isDefault"]).toBe(false);
    expect(savedArg["orderFlag"]).toBe(0);
    expect(savedArg["remindersList"]).toBe("Paprika");
    expect(savedArg["deleted"]).toBe(false);
    // UID must be uppercase UUID format
    expect(typeof savedArg["uid"]).toBe("string");
    expect(savedArg["uid"] as string).toMatch(/^[0-9A-F-]{36}$/);
    expect(resourceListChanged).toHaveBeenCalledOnce();
  });

  it("grocery-surface.AC1.4: store contains the new list after creation", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerCreateGroceryListTool(server, ctx);

    await callTool("create_grocery_list", { name: "Weekly Shopping" });

    // Store should contain the new list after commit
    const all = groceryListStore.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("Weekly Shopping");
  });

  it("grocery-surface.AC1.7: rejects duplicate name (exact case-insensitive match)", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const existing = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([existing]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerCreateGroceryListTool(server, ctx);

    const result = await callTool("create_grocery_list", { name: "weekly shopping" });
    const text = getText(result);

    expect(text).toContain("already exists");
    expect(text).toContain(existing.uid);
    expect(mockSaveGroceryList).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC1.7: allows creation when name matches only by starts-with (not exact)", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const existing = makeGroceryList({ name: "Weekly Shopping Costco" });
    groceryListStore.load([existing]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerCreateGroceryListTool(server, ctx);

    // "Weekly Shopping" is a prefix of "Weekly Shopping Costco" but not an exact match
    const result = await callTool("create_grocery_list", { name: "Weekly Shopping" });
    const text = getText(result);

    // Should succeed (not rejected), save should be called
    expect(mockSaveGroceryList).toHaveBeenCalledOnce();
    expect(text).toContain("Weekly Shopping");
  });
});

describe("rename_grocery_list tool", () => {
  it("grocery-surface.AC1.9: returns sync-not-ready message when stores not loaded", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    // DO NOT call .load()

    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: "some-uid", newName: "New Name" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.5: returns not-found when UID does not match any list", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: "nonexistent-uid", newName: "New Name" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
  });

  it("grocery-surface.AC1.5: renames list and calls save", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList, resourceListChanged } = makeWriteToolCtx(
      groceryListStore,
      groceryItemStore,
      server,
    );
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: list.uid, newName: "Costco Run" });
    const text = getText(result);

    expect(text).toContain("Costco Run");
    expect(mockSaveGroceryList).toHaveBeenCalledOnce();
    const savedArg = mockSaveGroceryList.mock.calls[0]![0] as Record<string, unknown>;
    expect(savedArg["name"]).toBe("Costco Run");
    expect(savedArg["uid"]).toBe(list.uid);
    expect(resourceListChanged).toHaveBeenCalledOnce();
  });

  it("grocery-surface.AC1.10: same name (exact case) is a no-op, does not call save", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: list.uid, newName: "Weekly Shopping" });
    const text = getText(result);

    // Should return existing list markdown without saving
    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
    expect(mockSaveGroceryList).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC1.10: same name (different case) is a no-op, does not call save", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: list.uid, newName: "weekly shopping" });
    const text = getText(result);

    expect(mockSaveGroceryList).not.toHaveBeenCalled();
    expect(text).toContain("Weekly Shopping");
  });

  it("grocery-surface.AC1.8: rejects rename when newName conflicts with another list", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Costco Run" });
    groceryListStore.load([listA, listB]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: listA.uid, newName: "Costco Run" });
    const text = getText(result);

    expect(text).toContain("already exists");
    expect(text).toContain(listB.uid);
    expect(mockSaveGroceryList).not.toHaveBeenCalled();
  });
});

describe("delete_grocery_list tool", () => {
  it("grocery-surface.AC1.9: returns sync-not-ready message when stores not loaded", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    // DO NOT call .load()

    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerDeleteGroceryListTool(server, ctx);

    const result = await callTool("delete_grocery_list", { uid: "some-uid" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.6: returns not-found for unknown UID (not tombstoned)", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    groceryListStore.load([]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerDeleteGroceryListTool(server, ctx);

    const result = await callTool("delete_grocery_list", { uid: "nonexistent-uid" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
    expect(mockSaveGroceryList).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC1.6: soft-deletes list by setting deleted: true", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList, resourceListChanged } = makeWriteToolCtx(
      groceryListStore,
      groceryItemStore,
      server,
    );
    registerDeleteGroceryListTool(server, ctx);

    const result = await callTool("delete_grocery_list", { uid: list.uid });
    const text = getText(result);

    expect(text).toContain("deleted");
    expect(mockSaveGroceryList).toHaveBeenCalledOnce();
    const savedArg = mockSaveGroceryList.mock.calls[0]![0] as Record<string, unknown>;
    expect(savedArg["deleted"]).toBe(true);
    expect(savedArg["uid"]).toBe(list.uid);
    expect(resourceListChanged).toHaveBeenCalledOnce();
  });

  it("grocery-surface.AC1.6: list becomes tombstoned after deletion", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerDeleteGroceryListTool(server, ctx);

    await callTool("delete_grocery_list", { uid: list.uid });

    expect(groceryListStore.isTombstone(list.uid)).toBe(true);
  });

  it("grocery-surface.AC1.11: tombstoned (already-deleted) UID returns idempotent message", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const list = makeGroceryList({ name: "Weekly Shopping" });
    groceryListStore.load([list]);
    groceryItemStore.load([]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerDeleteGroceryListTool(server, ctx);

    // First delete — tombstones the UID
    await callTool("delete_grocery_list", { uid: list.uid });
    mockSaveGroceryList.mockClear();

    // Second delete — should return idempotent message, NOT call save again
    const result = await callTool("delete_grocery_list", { uid: list.uid });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("already deleted");
    expect(mockSaveGroceryList).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC1.6: does not cascade to items (no saveGroceryItems call)", async () => {
    const groceryListStore = new GroceryListStore();
    const groceryItemStore = new GroceryItemStore();
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item = makeGroceryItem({ listUid: list.uid });
    groceryListStore.load([list]);
    groceryItemStore.load([item]);

    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx(groceryListStore, groceryItemStore, server);
    registerDeleteGroceryListTool(server, ctx);

    await callTool("delete_grocery_list", { uid: list.uid });

    // Only saveGroceryList should be called — no saveGroceryItems
    expect(mockSaveGroceryList).toHaveBeenCalledOnce();
    // client mock has no saveGroceryItems — if it were called it would throw
  });
});
