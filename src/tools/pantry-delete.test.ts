import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { registerDeletePantryItemTool } from "./pantry-delete.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
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

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockImplementation(async (items) => items);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({
        pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
        flush: mockFlush,
      }),
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", {
      uid: "uid-1",
    });
    const text = getText(result);

    expect(text).toContain('Pantry item "Butter" has been deleted.');
    expect(mockSavePantryItems).toHaveBeenCalledOnce();

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
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

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({
        pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
        flush: mockFlush,
      }),
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", {
      uid: "uid-1",
    });
    const text = getText(result);

    expect(text).toContain("already deleted");
    expect(text).toContain("Butter");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
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

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({
        pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
        flush: mockFlush,
      }),
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", {
      uid: "missing",
    });
    const text = getText(result);

    // Genuine unknown-UID case: not in items, not in tombstone set.
    expect(text).toContain("No pantry item found");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
    expect(mockRemovePantryItem).not.toHaveBeenCalled();
    expect(pantryStore.size).toBe(0);
  });

  it("pantry-mutations.AC6.4: cold-start guard blocks call before pantry synced", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore(); // hasSynced === false

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({
        pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
        flush: mockFlush,
      }),
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", {
      uid: "uid-1",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
  });

  it("pantry-mutations.AC6.5: savePantryItems API error returns error message, cache/store not mutated", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      ingredient: "Butter",
      deleted: false,
    });
    pantryStore.load([item]);

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockRejectedValue(new PaprikaAPIError("server timeout", 500, "https://example/api"));

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({
        pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
        flush: mockFlush,
      }),
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

  it("pantry-mutations.AC6.2-retry: production retry path — second call after successful delete returns 'already deleted'", async () => {
    // Codex P2 fix: in the production flow, commitPantryItem's delete branch
    // calls pantryStore.delete(uid), so the item is removed from the live
    // items map. Without a tombstone tracker, a retried delete would hit the
    // `!existing` branch and return "No pantry item found" — indistinguishable
    // from a genuinely invalid UID. Verifying the tombstone-aware path here.
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([
      makePantryItem({
        uid: "uid-retry" as PantryItemUid,
        ingredient: "Butter",
        deleted: false,
      }),
    ]);
    // Simulate the post-commit state: pantryStore.delete() was called, which
    // both removes from items AND records a tombstone.
    pantryStore.delete("uid-retry" as PantryItemUid);

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockRemovePantryItem = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({
        pantry: { put: mockPutPantryItem, remove: mockRemovePantryItem },
        flush: mockFlush,
      }),
    });
    registerDeletePantryItemTool(server, ctx);

    const result = await callTool("delete_pantry_item", { uid: "uid-retry" });
    const text = getText(result);

    expect(text).toContain("already deleted");
    expect(text).toContain("uid-retry");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
    expect(mockRemovePantryItem).not.toHaveBeenCalled();
  });
});
