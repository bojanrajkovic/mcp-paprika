import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { registerDeletePantryItemTool } from "./pantry-delete.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";
import type { PantryItemUid } from "../paprika/types.js";
import { PaprikaAPIError } from "../paprika/errors.js";

describe("pantry-mutations.AC6: delete_pantry_item tool", () => {
  it("pantry-mutations.AC6.1: happy path — sets deleted=true and commits", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      ingredient: "Butter",
      deleted: false,
    });
    pantryStore.load([item]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (itemArg) => itemArg);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: {
        putPantryItem: mockPutPantryItem,
        removePantryItem: mockRemovePantryItem,
        flush: mockFlush,
      } as unknown as DiskCache,
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", {
      uid: "uid-1",
    });
    const text = getText(result);

    expect(text).toContain('Pantry item "Butter" has been deleted.');
    expect(mockSavePantryItem).toHaveBeenCalledOnce();

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    expect(callArgs?.deleted).toBe(true);
    expect(callArgs?.ingredient).toBe("Butter");

    // Verify deleteBranch was taken (removePantryItem called, not putPantryItem)
    expect(mockRemovePantryItem).toHaveBeenCalledOnce();
    expect(mockPutPantryItem).not.toHaveBeenCalled();

    // Verify item is gone from the store
    const after = pantryStore.get("uid-1" as PantryItemUid);
    expect(after).toBeUndefined();
  });

  it("pantry-mutations.AC6.2: idempotent already-deleted — returns message, no re-save", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      ingredient: "Butter",
      deleted: true,
    });
    pantryStore.load([item]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: {
        putPantryItem: mockPutPantryItem,
        removePantryItem: mockRemovePantryItem,
        flush: mockFlush,
      } as unknown as DiskCache,
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", {
      uid: "uid-1",
    });
    const text = getText(result);

    expect(text).toContain("already deleted");
    expect(text).toContain("Butter");
    expect(mockSavePantryItem).not.toHaveBeenCalled();
    expect(mockRemovePantryItem).not.toHaveBeenCalled();

    // Verify store state unchanged
    expect(pantryStore.size).toBe(1);
    const after = pantryStore.get("uid-1" as PantryItemUid);
    expect(after).toBeDefined();
    expect(after?.deleted).toBe(true);
  });

  it("pantry-mutations.AC6.3: unknown UID returns no-item-found, cache/store not mutated", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: {
        putPantryItem: mockPutPantryItem,
        removePantryItem: mockRemovePantryItem,
        flush: mockFlush,
      } as unknown as DiskCache,
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", {
      uid: "missing",
    });
    const text = getText(result);

    expect(text).toContain("No pantry item found");
    expect(mockSavePantryItem).not.toHaveBeenCalled();
    expect(mockRemovePantryItem).not.toHaveBeenCalled();
    expect(pantryStore.size).toBe(0);
  });

  it("pantry-mutations.AC6.4: cold-start guard blocks call before pantry synced", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore(); // hasSynced === false

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: {
        putPantryItem: mockPutPantryItem,
        removePantryItem: mockRemovePantryItem,
        flush: mockFlush,
      } as unknown as DiskCache,
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", {
      uid: "uid-1",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSavePantryItem).not.toHaveBeenCalled();
  });

  it("pantry-mutations.AC6.5: savePantryItem API error returns error message, cache/store not mutated", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      ingredient: "Butter",
      deleted: false,
    });
    pantryStore.load([item]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockRejectedValue(new PaprikaAPIError("server timeout", 500, "https://example/api"));

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: {
        putPantryItem: mockPutPantryItem,
        removePantryItem: mockRemovePantryItem,
        flush: mockFlush,
      } as unknown as DiskCache,
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", {
      uid: "uid-1",
    });
    const text = getText(result);

    expect(text).toContain("Failed to delete pantry item");
    expect(text).toContain("server timeout");
    expect(mockRemovePantryItem).not.toHaveBeenCalled();
    // Verify the original (not-yet-deleted) item is still in the store
    const after = pantryStore.get("uid-1" as PantryItemUid);
    expect(after).toBeDefined();
    expect(after?.deleted).toBe(false);
  });
});
