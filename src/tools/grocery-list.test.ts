import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import type { SeedData } from "../../test/support/tool-test-utils.js";

import { makeGroceryItem } from "../../test/cache/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../test/cache/__fixtures__/grocery-lists.js";
import { getText, makeCtx, makeStubNotifier, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import {
  registerCreateGroceryListTool,
  registerDeleteGroceryListTool,
  registerListGroceryListsTool,
  registerReadGroceryListTool,
  registerRenameGroceryListTool,
} from "./grocery-list.js";

describe("list_grocery_lists tool", () => {
  it("grocery-surface.AC1.9: returns sync-not-ready message when stores not loaded", async () => {
    // DO NOT seed grocery stores
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server);
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.1: returns empty message when no lists exist", async () => {
    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { groceryLists: [], groceryItems: [] });
    registerListGroceryListsTool(server, ctx);

    const result = await callTool("list_grocery_lists", {});
    const text = getText(result);

    expect(text).toBe("No grocery lists found.");
  });

  it("grocery-surface.AC1.1: returns list names, UIDs, and item counts", async () => {
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Costco Run" });

    const item1 = makeGroceryItem({ listUid: listA.uid });
    const item2 = makeGroceryItem({ listUid: listA.uid });
    const item3 = makeGroceryItem({ listUid: listB.uid });

    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      groceryLists: [listA, listB],
      groceryItems: [item1, item2, item3],
    });
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
    const listZ = makeGroceryList({ name: "Zebra Market" });
    const listA = makeGroceryList({ name: "Aldi Trip" });
    const listM = makeGroceryList({ name: "Monthly Stock" });

    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      groceryLists: [listZ, listA, listM],
      groceryItems: [],
    });
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
    // DO NOT seed grocery stores
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server);
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { uid: "some-uid" } });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.2: returns not-found when UID does not match any list", async () => {
    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { groceryLists: [], groceryItems: [] });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { uid: "nonexistent-uid" } });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
  });

  it("grocery-surface.AC1.2: returns list metadata and items when fetched by UID", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item1 = makeGroceryItem({ listUid: list.uid, ingredient: "Apples" });
    const item2 = makeGroceryItem({ listUid: list.uid, ingredient: "Milk" });

    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      groceryLists: [list],
      groceryItems: [item1, item2],
    });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { uid: list.uid } });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
    expect(text).toContain("Apples");
    expect(text).toContain("Milk");
  });

  it("grocery-surface.AC1.3: resolves by exact name match", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });

    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { groceryLists: [list], groceryItems: [] });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { name: "Weekly Shopping" } });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("grocery-surface.AC1.3: resolves by starts-with name match", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });

    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { groceryLists: [list], groceryItems: [] });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { name: "Weekly" } });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("grocery-surface.AC1.3: resolves by contains name match", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });

    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), { groceryLists: [list], groceryItems: [] });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { name: "Shopping" } });
    const text = getText(result);

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("grocery-surface.AC1.3: returns not-found when name does not match any list", async () => {
    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      groceryLists: [makeGroceryList({ name: "Weekly Shopping" })],
      groceryItems: [],
    });
    registerReadGroceryListTool(server, ctx);

    const result = await callTool("read_grocery_list", { lookup: { name: "Completely Different" } });
    const text = getText(result);

    // #142: the no-match wording is normalized to the plural form shared by
    // read_recipe / get_pantry_item via the consolidated formatLookupOutcome.
    expect(text.toLowerCase()).toContain("no grocery lists found matching");
  });

  it("grocery-surface.AC1.3: returns disambiguation when multiple lists match the same tier", async () => {
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Weekly Costco" });

    const { server, callTool } = makeTestServer();
    const ctx = seed(makeCtx(new RecipeStore(), server), {
      groceryLists: [listA, listB],
      groceryItems: [],
    });
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
function makeWriteToolCtx(seedData: SeedData, server: ReturnType<typeof makeTestServer>["server"]) {
  const mockSaveGroceryList = vi.fn().mockImplementation(async (list: unknown) => list);
  const mockNotifySync = vi.fn().mockResolvedValue(undefined);
  const mockPutGroceryList = vi.fn();
  const mockRemoveGroceryList = vi.fn();
  const mockFlush = vi.fn().mockResolvedValue(undefined);
  const { notifier, resourceListChanged } = makeStubNotifier();

  const ctx = makeCtx(new RecipeStore(), server, {
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
  seed(ctx, seedData);

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
    // DO NOT seed grocery stores
    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx({}, server);
    registerCreateGroceryListTool(server, ctx);

    const result = await callTool("create_grocery_list", { name: "Weekly Shopping" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.4: creates list with uppercase UUID and correct defaults", async () => {
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList, resourceListChanged } = makeWriteToolCtx(
      { groceryLists: [], groceryItems: [] },
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
    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx({ groceryLists: [], groceryItems: [] }, server);
    registerCreateGroceryListTool(server, ctx);

    await callTool("create_grocery_list", { name: "Weekly Shopping" });

    // Store should contain the new list after commit
    const all = ctx.groceryListStore.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("Weekly Shopping");
  });

  it("grocery-surface.AC1.7: rejects duplicate name (exact case-insensitive match)", async () => {
    const existing = makeGroceryList({ name: "Weekly Shopping" });
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx({ groceryLists: [existing], groceryItems: [] }, server);
    registerCreateGroceryListTool(server, ctx);

    const result = await callTool("create_grocery_list", { name: "weekly shopping" });
    const text = getText(result);

    expect(text).toContain("already exists");
    expect(text).toContain(existing.uid);
    expect(mockSaveGroceryList).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC1.7: allows creation when name matches only by starts-with (not exact)", async () => {
    const existing = makeGroceryList({ name: "Weekly Shopping Costco" });
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx({ groceryLists: [existing], groceryItems: [] }, server);
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
    // DO NOT seed grocery stores
    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx({}, server);
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: "some-uid", newName: "New Name" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.5: returns not-found when UID does not match any list", async () => {
    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx({ groceryLists: [], groceryItems: [] }, server);
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: "nonexistent-uid", newName: "New Name" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
  });

  it("grocery-surface.AC1.5: renames list and calls save", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList, resourceListChanged } = makeWriteToolCtx(
      { groceryLists: [list], groceryItems: [] },
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
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx({ groceryLists: [list], groceryItems: [] }, server);
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: list.uid, newName: "Weekly Shopping" });
    const text = getText(result);

    // Should return existing list markdown without saving
    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
    expect(mockSaveGroceryList).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC1.10: same name (different case) is a no-op, does not call save", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx({ groceryLists: [list], groceryItems: [] }, server);
    registerRenameGroceryListTool(server, ctx);

    const result = await callTool("rename_grocery_list", { uid: list.uid, newName: "weekly shopping" });
    const text = getText(result);

    expect(mockSaveGroceryList).not.toHaveBeenCalled();
    expect(text).toContain("Weekly Shopping");
  });

  it("grocery-surface.AC1.8: rejects rename when newName conflicts with another list", async () => {
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Costco Run" });
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx({ groceryLists: [listA, listB], groceryItems: [] }, server);
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
    // DO NOT seed grocery stores
    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx({}, server);
    registerDeleteGroceryListTool(server, ctx);

    const result = await callTool("delete_grocery_list", { uid: "some-uid" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("grocery-surface.AC1.6: returns not-found for unknown UID (not tombstoned)", async () => {
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx({ groceryLists: [], groceryItems: [] }, server);
    registerDeleteGroceryListTool(server, ctx);

    const result = await callTool("delete_grocery_list", { uid: "nonexistent-uid" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
    expect(mockSaveGroceryList).not.toHaveBeenCalled();
  });

  it("grocery-surface.AC1.6: soft-deletes list by setting deleted: true", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList, resourceListChanged } = makeWriteToolCtx(
      { groceryLists: [list], groceryItems: [] },
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
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const { server, callTool } = makeTestServer();
    const { ctx } = makeWriteToolCtx({ groceryLists: [list], groceryItems: [] }, server);
    registerDeleteGroceryListTool(server, ctx);

    await callTool("delete_grocery_list", { uid: list.uid });

    expect(ctx.groceryListStore.isTombstone(list.uid)).toBe(true);
  });

  it("grocery-surface.AC1.11: tombstoned (already-deleted) UID returns idempotent message", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx({ groceryLists: [list], groceryItems: [] }, server);
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
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item = makeGroceryItem({ listUid: list.uid });
    const { server, callTool } = makeTestServer();
    const { ctx, mockSaveGroceryList } = makeWriteToolCtx({ groceryLists: [list], groceryItems: [item] }, server);
    registerDeleteGroceryListTool(server, ctx);

    await callTool("delete_grocery_list", { uid: list.uid });

    // Only saveGroceryList should be called — no saveGroceryItems
    expect(mockSaveGroceryList).toHaveBeenCalledOnce();
    // client mock has no saveGroceryItems — if it were called it would throw
  });
});
