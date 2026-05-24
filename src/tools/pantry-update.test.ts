import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { registerUpdatePantryItemTool } from "./pantry-update.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCacheRoot } from "../cache/disk/index.js";
import type { PantryItemUid } from "../paprika/types.js";
import { PaprikaAPIError } from "../paprika/errors.js";

describe("pantry-mutations.AC5: update_pantry_item tool", () => {
  it("pantry-mutations.AC5.1: partial merge — only provided fields change", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      ingredient: "Butter",
      quantity: "1 lb",
      aisle: "Dairy",
      inStock: true,
      notes: "salted",
    });
    pantryStore.load([item]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (itemArg) => itemArg);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { pantry: { put: mockPutPantryItem }, flush: mockFlush } as unknown as DiskCacheRoot,
    });
    registerUpdatePantryItemTool(server, ctx);

    const result = await callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2 lb",
    });
    const text = getText(result);

    expect(text).toContain("Butter");
    expect(mockSavePantryItem).toHaveBeenCalledOnce();

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.quantity).toBe("2 lb");
    expect(callArgs?.ingredient).toBe("Butter");
    expect(callArgs?.aisle).toBe("Dairy");
    expect(callArgs?.inStock).toBe(true);
    expect(callArgs?.notes).toBe("salted");
    expect(callArgs?.uid).toBe("uid-1");
  });

  it("pantry-mutations.AC5.2: setting inStock=false persists correctly", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      ingredient: "Milk",
      inStock: true,
    });
    pantryStore.load([item]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (itemArg) => itemArg);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { pantry: { put: mockPutPantryItem }, flush: mockFlush } as unknown as DiskCacheRoot,
    });
    registerUpdatePantryItemTool(server, ctx);

    const result = await callTool("update_pantry_item", {
      uid: "uid-1",
      inStock: false,
    });
    const text = getText(result);

    expect(text).toContain("**In stock:** No");

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    expect(callArgs?.inStock).toBe(false);
  });

  it("pantry-mutations.AC5.3a: expirationDate provided as string derives hasExpiration=true", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      expirationDate: null,
      hasExpiration: false,
    });
    pantryStore.load([item]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (itemArg) => itemArg);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { pantry: { put: mockPutPantryItem }, flush: mockFlush } as unknown as DiskCacheRoot,
    });
    registerUpdatePantryItemTool(server, ctx);

    await callTool("update_pantry_item", {
      uid: "uid-1",
      expirationDate: "2026-12-31",
    });

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    // User input is normalized to Paprika wire format ("yyyy-MM-dd HH:mm:ss" at midnight).
    expect(callArgs?.expirationDate).toBe("2026-12-31 00:00:00");
    expect(callArgs?.hasExpiration).toBe(true);
  });

  it("pantry-mutations.AC5.3b: expirationDate provided as null derives hasExpiration=false", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      expirationDate: "2026-12-31",
      hasExpiration: true,
    });
    pantryStore.load([item]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (itemArg) => itemArg);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { pantry: { put: mockPutPantryItem }, flush: mockFlush } as unknown as DiskCacheRoot,
    });
    registerUpdatePantryItemTool(server, ctx);

    await callTool("update_pantry_item", {
      uid: "uid-1",
      expirationDate: null,
    });

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    expect(callArgs?.expirationDate).toBe(null);
    expect(callArgs?.hasExpiration).toBe(false);
  });

  it("pantry-mutations.AC5.3c: expirationDate omitted leaves both unchanged", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      expirationDate: "2026-12-31",
      hasExpiration: true,
    });
    pantryStore.load([item]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (itemArg) => itemArg);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { pantry: { put: mockPutPantryItem }, flush: mockFlush } as unknown as DiskCacheRoot,
    });
    registerUpdatePantryItemTool(server, ctx);

    await callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2 lb",
    });

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    expect(callArgs?.expirationDate).toBe("2026-12-31");
    expect(callArgs?.hasExpiration).toBe(true);
  });

  it("pantry-mutations.AC5.4: unknown UID returns no-item-found, cache/store not mutated", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { pantry: { put: mockPutPantryItem }, flush: mockFlush } as unknown as DiskCacheRoot,
    });
    registerUpdatePantryItemTool(server, ctx);

    const result = await callTool("update_pantry_item", {
      uid: "missing",
      quantity: "2",
    });
    const text = getText(result);

    expect(text).toContain("No pantry item found");
    expect(mockSavePantryItem).not.toHaveBeenCalled();
    expect(mockPutPantryItem).not.toHaveBeenCalled();
    expect(pantryStore.size).toBe(0);
  });

  it("pantry-mutations.AC5.5: cold-start guard blocks call before pantry synced", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore(); // hasSynced === false

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { pantry: { put: mockPutPantryItem }, flush: mockFlush } as unknown as DiskCacheRoot,
    });
    registerUpdatePantryItemTool(server, ctx);

    const result = await callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSavePantryItem).not.toHaveBeenCalled();
  });

  it("pantry-mutations.AC5.6: savePantryItem API error returns error message, cache/store not mutated", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      quantity: "1 lb",
    });
    pantryStore.load([item]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockRejectedValue(new PaprikaAPIError("server timeout", 500, "https://example/api"));

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { pantry: { put: mockPutPantryItem }, flush: mockFlush } as unknown as DiskCacheRoot,
    });
    registerUpdatePantryItemTool(server, ctx);

    const result = await callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2 lb",
    });
    const text = getText(result);

    expect(text).toContain("Failed to update pantry item");
    expect(text).toContain("server timeout");
    expect(mockPutPantryItem).not.toHaveBeenCalled();
    // Verify the original item is still in the store
    const after = pantryStore.get("uid-1" as PantryItemUid);
    expect(after).toBeDefined();
    expect(after?.quantity).toBe("1 lb");
  });
});
