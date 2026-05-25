import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { AisleStore } from "../cache/aisle-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { makeAisle } from "../cache/__fixtures__/aisles.js";
import { registerUpdatePantryItemTool } from "./pantry-update.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
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

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockImplementation(async (items) => items);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerUpdatePantryItemTool(server, ctx);

    const result = await callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2 lb",
    });
    const text = getText(result);

    expect(text).toContain("Butter");
    expect(mockSavePantryItems).toHaveBeenCalledOnce();

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
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

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockImplementation(async (items) => items);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerUpdatePantryItemTool(server, ctx);

    const result = await callTool("update_pantry_item", {
      uid: "uid-1",
      inStock: false,
    });
    const text = getText(result);

    expect(text).toContain("**In stock:** No");

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
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

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockImplementation(async (items) => items);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerUpdatePantryItemTool(server, ctx);

    await callTool("update_pantry_item", {
      uid: "uid-1",
      expirationDate: "2026-12-31",
    });

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
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

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockImplementation(async (items) => items);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerUpdatePantryItemTool(server, ctx);

    await callTool("update_pantry_item", {
      uid: "uid-1",
      expirationDate: null,
    });

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
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

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockImplementation(async (items) => items);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerUpdatePantryItemTool(server, ctx);

    await callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2 lb",
    });

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(callArgs?.expirationDate).toBe("2026-12-31");
    expect(callArgs?.hasExpiration).toBe(true);
  });

  it("pantry-mutations.AC5.4: unknown UID returns no-item-found, cache/store not mutated", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerUpdatePantryItemTool(server, ctx);

    const result = await callTool("update_pantry_item", {
      uid: "missing",
      quantity: "2",
    });
    const text = getText(result);

    expect(text).toContain("No pantry item found");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
    expect(mockPutPantryItem).not.toHaveBeenCalled();
    expect(pantryStore.size).toBe(0);
  });

  it("pantry-mutations.AC5.5: cold-start guard blocks call before pantry synced", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore(); // hasSynced === false

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerUpdatePantryItemTool(server, ctx);

    const result = await callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
  });

  it("pantry-mutations.AC5.aisle-resolve: known aisle sets both aisle and aisleUid", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const dairyAisle = makeAisle({ name: "Dairy" });
    const aisleStore = new AisleStore();
    aisleStore.load([dairyAisle]);
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      aisle: "Old Aisle",
      aisleUid: "old-uid",
    });
    pantryStore.load([item]);

    const mockSavePantryItems = vi.fn().mockImplementation(async (items) => items);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      aisleStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerUpdatePantryItemTool(server, ctx);

    await callTool("update_pantry_item", { uid: "uid-1", aisle: "Dairy" });

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(callArgs?.aisle).toBe("Dairy");
    expect(callArgs?.aisleUid).toBe(dairyAisle.uid);
  });

  it("pantry-mutations.AC5.aisle-preserve: omitting aisle preserves both aisle and aisleUid", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const aisleStore = new AisleStore();
    aisleStore.load([]);
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      aisle: "Frozen",
      aisleUid: "frozen-uid",
    });
    pantryStore.load([item]);

    const mockSavePantryItems = vi.fn().mockImplementation(async (items) => items);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      aisleStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerUpdatePantryItemTool(server, ctx);

    await callTool("update_pantry_item", { uid: "uid-1", quantity: "3 lbs" });

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(callArgs?.aisle).toBe("Frozen");
    expect(callArgs?.aisleUid).toBe("frozen-uid");
  });

  it("pantry-mutations.AC5.aisle-autocreate: unknown aisle is created and both fields set", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const aisleStore = new AisleStore();
    aisleStore.load([]);
    const item = makePantryItem({ uid: "uid-1" as PantryItemUid });
    pantryStore.load([item]);

    const newAisle = makeAisle({ name: "International" });
    const mockSaveAisle = vi.fn().mockResolvedValue(newAisle);
    const mockSavePantryItems = vi.fn().mockImplementation(async (items) => items);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockPutAisle = vi.fn().mockResolvedValue(undefined);
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      aisleStore,
      client: fromAny({
        saveAisle: mockSaveAisle,
        savePantryItems: mockSavePantryItems,
        notifySync: mockNotifySync,
      }),
      cache: fromAny({
        pantry: { put: mockPutPantryItem },
        aisles: { put: mockPutAisle },
        flush: mockFlush,
      }),
    });
    registerUpdatePantryItemTool(server, ctx);

    await callTool("update_pantry_item", { uid: "uid-1", aisle: "International" });

    expect(mockSaveAisle).toHaveBeenCalledOnce();
    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(callArgs?.aisle).toBe(newAisle.name);
    expect(callArgs?.aisleUid).toBe(newAisle.uid);
  });

  it("pantry-mutations.AC5.6: savePantryItems API error returns error message, cache/store not mutated", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      quantity: "1 lb",
    });
    pantryStore.load([item]);

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockRejectedValue(new PaprikaAPIError("server timeout", 500, "https://example/api"));

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
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
