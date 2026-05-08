import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { registerAddPantryItemTool } from "./pantry-add.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";
import type { PaprikaClient } from "../paprika/client.js";
import type { DiskCache } from "../cache/disk-cache.js";
import type { PantryItemUid } from "../paprika/types.js";
import { PaprikaAPIError } from "../paprika/errors.js";

describe("pantry-mutations.AC4: add_pantry_item tool", () => {
  it("pantry-mutations.AC4.1: required ingredient field creates pantry item with defaults", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (item) => item);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { putPantryItem: mockPutPantryItem, flush: mockFlush } as unknown as DiskCache,
    });
    registerAddPantryItemTool(server, ctx);

    const result = await callTool("add_pantry_item", {
      ingredient: "Butter",
    });
    const text = getText(result);

    expect(text).toContain("# Butter");
    expect(mockSavePantryItem).toHaveBeenCalledOnce();

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    expect(callArgs).toBeDefined();
    expect(callArgs?.ingredient).toBe("Butter");
    expect(callArgs?.quantity).toBe("");
    expect(callArgs?.aisle).toBe("");
    expect(callArgs?.aisleUid).toBe("");
    expect(callArgs?.expirationDate).toBe(null);
    expect(callArgs?.hasExpiration).toBe(false);
    expect(callArgs?.inStock).toBe(true);
    expect(callArgs?.locationUid).toBe(null);
    expect(callArgs?.notes).toBe(null);
    expect(callArgs?.deleted).toBe(false);

    // UUID v4 regex
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(callArgs?.uid).toMatch(uuidRegex);

    // ISO 8601 timestamp regex
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/;
    expect(callArgs?.purchaseDate).toMatch(isoRegex);

    // Verify commit happened
    expect(pantryStore.get(callArgs?.uid as PantryItemUid)).toBeDefined();
  });

  it("pantry-mutations.AC4.2: expirationDate derives hasExpiration=true", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (item) => item);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { putPantryItem: mockPutPantryItem, flush: mockFlush } as unknown as DiskCache,
    });
    registerAddPantryItemTool(server, ctx);

    await callTool("add_pantry_item", {
      ingredient: "Milk",
      expirationDate: "2026-12-31",
    });

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    expect(callArgs?.expirationDate).toBe("2026-12-31");
    expect(callArgs?.hasExpiration).toBe(true);
  });

  it("pantry-mutations.AC4.3: omitted expirationDate defaults to null and hasExpiration=false", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (item) => item);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { putPantryItem: mockPutPantryItem, flush: mockFlush } as unknown as DiskCache,
    });
    registerAddPantryItemTool(server, ctx);

    await callTool("add_pantry_item", {
      ingredient: "Eggs",
    });

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    expect(callArgs?.expirationDate).toBe(null);
    expect(callArgs?.hasExpiration).toBe(false);
    // Note: The handler input schema does not accept hasExpiration, so there's
    // no need to test explicit hasExpiration override — the schema makes
    // that case unrepresentable per AC4.3.
  });

  it("pantry-mutations.AC4.4: optional args flow through to constructed item", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockImplementation(async (item) => item);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { putPantryItem: mockPutPantryItem, flush: mockFlush } as unknown as DiskCache,
    });
    registerAddPantryItemTool(server, ctx);

    await callTool("add_pantry_item", {
      ingredient: "Apples",
      quantity: "6",
      aisle: "Produce",
      inStock: false,
      notes: "for the pie",
    });

    const callArgs = mockSavePantryItem.mock.calls[0]?.[0];
    expect(callArgs?.ingredient).toBe("Apples");
    expect(callArgs?.quantity).toBe("6");
    expect(callArgs?.aisle).toBe("Produce");
    expect(callArgs?.inStock).toBe(false);
    expect(callArgs?.notes).toBe("for the pie");
  });

  it("pantry-mutations.AC4.5: duplicate ingredient (case-insensitive) rejected with existing UID", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const existingItem = makePantryItem({ ingredient: "Butter", uid: "existing-uid" as PantryItemUid });
    pantryStore.load([existingItem]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { putPantryItem: mockPutPantryItem, flush: mockFlush } as unknown as DiskCache,
    });
    registerAddPantryItemTool(server, ctx);

    const result = await callTool("add_pantry_item", {
      ingredient: "BUTTER",
    });
    const text = getText(result);

    expect(text).toContain("existing-uid");
    expect(text).toContain("update_pantry_item");
    expect(mockSavePantryItem).not.toHaveBeenCalled();
    expect(mockPutPantryItem).not.toHaveBeenCalled();
    expect(pantryStore.size).toBe(1);
    expect(pantryStore.get("existing-uid" as PantryItemUid)).toBeDefined();
  });

  it("pantry-mutations.AC4.6: cold-start guard blocks call before pantry synced", async () => {
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
      cache: { putPantryItem: mockPutPantryItem, flush: mockFlush } as unknown as DiskCache,
    });
    registerAddPantryItemTool(server, ctx);

    const result = await callTool("add_pantry_item", {
      ingredient: "Butter",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSavePantryItem).not.toHaveBeenCalled();
  });

  it("pantry-mutations.AC4.7: savePantryItem API error returns error message, cache/store not mutated", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItem = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItem.mockRejectedValue(new PaprikaAPIError("Server error", 500, "https://example/api"));

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: { savePantryItem: mockSavePantryItem, notifySync: mockNotifySync } as unknown as PaprikaClient,
      cache: { putPantryItem: mockPutPantryItem, flush: mockFlush } as unknown as DiskCache,
    });
    registerAddPantryItemTool(server, ctx);

    const result = await callTool("add_pantry_item", {
      ingredient: "Butter",
    });
    const text = getText(result);

    expect(text).toContain("Failed to add pantry item");
    expect(text).toContain("Server error");
    expect(mockPutPantryItem.mock.calls.length).toBe(0);
    expect(mockFlush.mock.calls.length).toBe(0);
    expect(pantryStore.size).toBe(0);
  });
});
