import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { PantryStore } from "../cache/pantry-store.js";
import { AisleStore } from "../cache/aisle-store.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { makeAisle } from "../cache/__fixtures__/aisles.js";
import { registerAddPantryItemTool } from "./pantry-add.js";
import { makeTestServer, makeCtx, getText, makePinoCapture } from "./tool-test-utils.js";
import type { PantryItemUid } from "../paprika/types.js";
import { PaprikaAPIError } from "../paprika/errors.js";

describe("pantry-mutations.AC4: add_pantry_item tool", () => {
  it("pantry-mutations.AC4.1: required ingredient field creates pantry item with defaults", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

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
    registerAddPantryItemTool(server, ctx);

    const result = await callTool("add_pantry_item", {
      ingredient: "Butter",
    });
    const text = getText(result);

    expect(text).toContain("# Butter");
    expect(mockSavePantryItems).toHaveBeenCalledOnce();

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(callArgs).toBeDefined();
    expect(callArgs?.ingredient).toBe("Butter");
    expect(callArgs?.quantity).toBe("");
    expect(callArgs?.aisle).toBe("");
    expect(callArgs?.aisleUid).toBe("");
    expect(callArgs?.expirationDate).toBe(null);
    expect(callArgs?.hasExpiration).toBe(false);
    expect(callArgs?.inStock).toBe(true);
    expect(callArgs?.notes).toBe(null);
    expect(callArgs?.deleted).toBe(false);

    // UUID v4 regex (Paprika expects uppercase to match its app's wire format)
    const uuidRegex = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
    expect(callArgs?.uid).toMatch(uuidRegex);

    // Paprika wire date format: "yyyy-MM-dd HH:mm:ss" (today's date at midnight, no timezone)
    const paprikaDateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    expect(callArgs?.purchaseDate).toMatch(paprikaDateRegex);

    // Verify commit happened
    expect(pantryStore.get(callArgs?.uid as PantryItemUid)).toBeDefined();
  });

  it("pantry-mutations.AC4.2: expirationDate derives hasExpiration=true", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

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
    registerAddPantryItemTool(server, ctx);

    await callTool("add_pantry_item", {
      ingredient: "Milk",
      expirationDate: "2026-12-31",
    });

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    // User input is normalized to Paprika wire format ("yyyy-MM-dd HH:mm:ss" at midnight).
    expect(callArgs?.expirationDate).toBe("2026-12-31 00:00:00");
    expect(callArgs?.hasExpiration).toBe(true);
  });

  it("pantry-mutations.AC4.3: omitted expirationDate defaults to null and hasExpiration=false", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

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
    registerAddPantryItemTool(server, ctx);

    await callTool("add_pantry_item", {
      ingredient: "Eggs",
    });

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
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

    const produceAisle = makeAisle({ name: "Produce" });
    const aisleStore = new AisleStore();
    aisleStore.load([produceAisle]);

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockImplementation(async (items) => items);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      aisleStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerAddPantryItemTool(server, ctx);

    await callTool("add_pantry_item", {
      ingredient: "Apples",
      quantity: "6",
      aisle: "Produce",
      inStock: false,
      notes: "for the pie",
    });

    const [callArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(callArgs?.ingredient).toBe("Apples");
    expect(callArgs?.quantity).toBe("6");
    expect(callArgs?.aisle).toBe("Produce");
    expect(callArgs?.aisleUid).toBe(produceAisle.uid);
    expect(callArgs?.inStock).toBe(false);
    expect(callArgs?.notes).toBe("for the pie");
  });

  it("pantry-mutations.AC4.4b: unknown aisle is auto-created and threads through", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const aisleStore = new AisleStore();
    aisleStore.load([]);

    const savedAisle = makeAisle({ name: "Exotic" });
    const mockSaveAisle = vi.fn().mockResolvedValue(savedAisle);
    const mockSavePantryItems = vi.fn().mockImplementation(async (items) => items);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockPutAisle = vi.fn();
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
    registerAddPantryItemTool(server, ctx);

    await callTool("add_pantry_item", {
      ingredient: "Dragon Fruit",
      aisle: "Exotic",
    });

    expect(mockSaveAisle).toHaveBeenCalledOnce();
    const [pantryArgs] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(pantryArgs?.aisle).toBe(savedAisle.name);
    expect(pantryArgs?.aisleUid).toBe(savedAisle.uid);
  });

  it("pantry-mutations.AC4.5: duplicate ingredient (case-insensitive) rejected with existing UID", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    const existingItem = makePantryItem({ ingredient: "Butter", uid: "existing-uid" as PantryItemUid });
    pantryStore.load([existingItem]);

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
    registerAddPantryItemTool(server, ctx);

    const result = await callTool("add_pantry_item", {
      ingredient: "BUTTER",
    });
    const text = getText(result);

    expect(text).toContain("existing-uid");
    expect(text).toContain("update_pantry_item");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
    expect(mockPutPantryItem).not.toHaveBeenCalled();
    expect(pantryStore.size).toBe(1);
    expect(pantryStore.get("existing-uid" as PantryItemUid)).toBeDefined();
  });

  it("pantry-mutations.AC4.6: cold-start guard blocks call before pantry synced", async () => {
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
    registerAddPantryItemTool(server, ctx);

    const result = await callTool("add_pantry_item", {
      ingredient: "Butter",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
  });

  it("pantry-mutations.AC4.7: savePantryItems API error returns error message, cache/store not mutated", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItems = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    mockSavePantryItems.mockRejectedValue(new PaprikaAPIError("Server error", 500, "https://example/api"));

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
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

  it("observability.1: savePantryItems error is captured as a structured log record", async () => {
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);

    const mockSavePantryItems = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);

    const { log, records } = makePinoCapture();
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      pantryStore,
      log,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
    });
    registerAddPantryItemTool(server, ctx);

    await callTool("add_pantry_item", { ingredient: "Butter" });

    const errorRecord = records.find((r) => r["msg"] === "savePantryItems failed");
    expect(errorRecord).toBeDefined();
    expect(errorRecord?.["component"]).toBe("add_pantry_item");
    expect((errorRecord?.["err"] as { message?: string })?.message).toContain("fetch failed");
  });

  it("pantry-mutations.AC4.invocation: add_pantry_item logs invocation at info level with ingredient", async () => {
    const { log, records } = makePinoCapture();
    const store = new RecipeStore();
    const pantryStore = new PantryStore();
    pantryStore.load([]);
    const mockSavePantryItems = vi.fn().mockImplementation(async (items: unknown) => items);
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(store, server, {
      log,
      pantryStore,
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerAddPantryItemTool(server, ctx);

    await callTool("add_pantry_item", { ingredient: "Butter" });

    const invocation = records.find((r) => r["msg"] === "tool invoked");
    expect(invocation).toBeDefined();
    expect(invocation?.["tool"]).toBe("add_pantry_item");
    expect(invocation?.["ingredient"]).toBe("Butter");
    expect(invocation?.["level"]).toBe(30); // pino info = 30
  });
});
