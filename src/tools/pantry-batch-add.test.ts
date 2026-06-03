import { fromAny } from "@total-typescript/shoehorn";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AisleUid, PantryItemUid } from "../ids.js";

import { makeAisle } from "../../test/cache/__fixtures__/aisles.js";
import { makePantryItem } from "../../test/cache/__fixtures__/pantry.js";
import { getText, makeCtx, makePinoCapture, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { AisleStore } from "../aisle/store.js";
import { PaprikaAPIError } from "../paprika/errors.js";
import { RecipeStore } from "../recipe/store.js";
import { registerAddPantryItemsTool } from "./pantry-batch-add.js";

describe("add_pantry_items tool", () => {
  let aisleStore: AisleStore;

  let mockSavePantryItems: ReturnType<typeof vi.fn>;
  let mockSaveAisle: ReturnType<typeof vi.fn>;
  let mockNotifySync: ReturnType<typeof vi.fn>;
  let mockPutPantryItem: ReturnType<typeof vi.fn>;
  let mockFlush: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    aisleStore = new AisleStore();

    mockSavePantryItems = vi.fn().mockImplementation(async (items) => items);
    mockSaveAisle = vi.fn();
    mockNotifySync = vi.fn().mockResolvedValue(undefined);
    mockPutPantryItem = vi.fn().mockResolvedValue(undefined);
    mockFlush = vi.fn().mockResolvedValue(undefined);

    aisleStore.load([makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" })]);
  });

  function makeAddCtx() {
    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        aisleStore,
        client: fromAny({
          savePantryItems: mockSavePantryItems,
          saveAisle: mockSaveAisle,
          notifySync: mockNotifySync,
        }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [] },
    );
    registerAddPantryItemsTool(server, ctx);
    return { server, callTool, ctx };
  }

  it("pantry-batch.1: single item with defaults creates pantry item with correct field values", async () => {
    const { callTool, ctx } = makeAddCtx();

    const result = await callTool("add_pantry_items", { items: [{ ingredient: "Butter" }] });
    const text = getText(result);

    expect(text).toContain("# Butter");
    expect(mockSavePantryItems).toHaveBeenCalledOnce();

    const [savedItem] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(savedItem?.ingredient).toBe("Butter");
    expect(savedItem?.quantity).toBe("");
    expect(savedItem?.aisle).toBe("");
    expect(savedItem?.aisleUid).toBe("");
    expect(savedItem?.inStock).toBe(true);
    expect(savedItem?.notes).toBe(null);
    expect(savedItem?.expirationDate).toBe(null);
    expect(savedItem?.hasExpiration).toBe(false);
    expect(savedItem?.deleted).toBe(false);

    const uuidRegex = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
    expect(savedItem?.uid).toMatch(uuidRegex);

    const paprikaDateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    expect(savedItem?.purchaseDate).toMatch(paprikaDateRegex);

    expect(ctx.pantryStore.get(savedItem?.uid as PantryItemUid)).toBeDefined();
  });

  it("pantry-batch.2: batch of 3 distinct items calls savePantryItems once with all 3", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_pantry_items", {
      items: [{ ingredient: "Apples" }, { ingredient: "Milk" }, { ingredient: "Eggs" }],
    });
    const text = getText(result);

    expect(mockSavePantryItems).toHaveBeenCalledOnce();
    const savedItems: Array<{ ingredient: string }> = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(savedItems).toHaveLength(3);
    expect(savedItems.map((i) => i.ingredient)).toEqual(["Apples", "Milk", "Eggs"]);
    expect(text).toContain("Added 3 item(s)");
    expect(mockFlush).toHaveBeenCalledOnce();
    expect(mockNotifySync).toHaveBeenCalledOnce();
  });

  it("pantry-batch.3: aisle dedup — repeated aisle name calls ensureAisle only once", async () => {
    const { callTool } = makeAddCtx();

    await callTool("add_pantry_items", {
      items: [
        { ingredient: "Apples", aisle: "Produce" },
        { ingredient: "Oranges", aisle: "Produce" },
        { ingredient: "Bananas", aisle: "produce" }, // different case — same aisle
      ],
    });

    const savedItems: Array<{ aisle: string; aisleUid: string }> = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    for (const item of savedItems) {
      expect(item.aisle).toBe("Produce");
      expect(item.aisleUid).toBe("AISLE-1");
    }
    // saveAisle not called because aisle already exists
    expect(mockSaveAisle).not.toHaveBeenCalled();
  });

  it("pantry-batch.4: existing-pantry duplicate skipped with UID and merge suggestion", async () => {
    const existingItem = makePantryItem({ ingredient: "Butter", uid: "EXISTING-UID" as PantryItemUid });
    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        aisleStore,
        client: fromAny({
          savePantryItems: mockSavePantryItems,
          saveAisle: mockSaveAisle,
          notifySync: mockNotifySync,
        }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [existingItem] },
    );
    registerAddPantryItemsTool(server, ctx);

    const result = await callTool("add_pantry_items", {
      items: [{ ingredient: "Eggs" }, { ingredient: "BUTTER" }], // BUTTER dupes existing
    });
    const text = getText(result);

    expect(text).toContain("Added 1 item(s)");
    expect(text).toContain("EXISTING-UID");
    expect(text).toContain("update_pantry_item");
    const savedItems: Array<{ ingredient: string }> = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(savedItems).toHaveLength(1);
    expect(savedItems[0]?.ingredient).toBe("Eggs");
  });

  it("pantry-batch.5: intra-batch duplicate — second occurrence skipped", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_pantry_items", {
      items: [{ ingredient: "Milk" }, { ingredient: "MILK" }],
    });
    const text = getText(result);

    expect(text).toContain("Added 1 item(s)");
    expect(text).toContain("MILK"); // skip report mentions the duplicate
    const savedItems: Array<unknown> = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(savedItems).toHaveLength(1);
  });

  it("pantry-batch.6: all duplicates short-circuits without API calls", async () => {
    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        aisleStore,
        client: fromAny({
          savePantryItems: mockSavePantryItems,
          saveAisle: mockSaveAisle,
          notifySync: mockNotifySync,
        }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [makePantryItem({ ingredient: "Butter", uid: "UID-1" as PantryItemUid })] },
    );
    registerAddPantryItemsTool(server, ctx);

    const result = await callTool("add_pantry_items", { items: [{ ingredient: "butter" }] });
    const text = getText(result);

    expect(text).toContain("All items were duplicates");
    expect(text).toContain("UID-1");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
  });

  it("pantry-batch.7: unparseable expirationDate rejects entire batch with item index", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_pantry_items", {
      items: [{ ingredient: "Apples" }, { ingredient: "Milk", expirationDate: "not-a-date" }],
    });
    const text = getText(result);

    expect(text).toContain('Item 1 ("Milk")');
    expect(text).toContain("expirationDate");
    expect(text).toContain("not-a-date");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
  });

  it("pantry-batch.8: unparseable purchaseDate rejects entire batch with item index", async () => {
    const { callTool } = makeAddCtx();

    const result = await callTool("add_pantry_items", {
      items: [{ ingredient: "Eggs", purchaseDate: "bad-date" }],
    });
    const text = getText(result);

    expect(text).toContain('Item 0 ("Eggs")');
    expect(text).toContain("purchaseDate");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
  });

  it("pantry-batch.9: valid dates normalized to Paprika wire format per item", async () => {
    const { callTool } = makeAddCtx();

    await callTool("add_pantry_items", {
      items: [
        {
          ingredient: "Yogurt",
          expirationDate: "2026-12-31",
          purchaseDate: "2026-06-01",
        },
      ],
    });

    const [savedItem] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(savedItem?.expirationDate).toBe("2026-12-31 00:00:00");
    expect(savedItem?.purchaseDate).toBe("2026-06-01 00:00:00");
    expect(savedItem?.hasExpiration).toBe(true);
  });

  it("pantry-batch.10: cold-start guard blocks call before pantry synced", async () => {
    const { server, callTool } = makeTestServer();
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    // pantryStore not seeded → hasSynced === false
    registerAddPantryItemsTool(server, ctx);

    const result = await callTool("add_pantry_items", { items: [{ ingredient: "Butter" }] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(mockSavePantryItems).not.toHaveBeenCalled();
  });

  it("pantry-batch.11: savePantryItems API error returns error message, cache/store not mutated", async () => {
    mockSavePantryItems.mockRejectedValue(new PaprikaAPIError("Server error", 500, "https://example/api"));
    const { callTool, ctx } = makeAddCtx();

    const result = await callTool("add_pantry_items", { items: [{ ingredient: "Butter" }] });
    const text = getText(result);

    expect(text).toContain("Failed to add pantry items");
    expect(text).toContain("Server error");
    expect(mockPutPantryItem).not.toHaveBeenCalled();
    expect(mockFlush).not.toHaveBeenCalled();
    expect(ctx.pantryStore.size).toBe(0);
  });

  it("pantry-batch.12: invocation logged at info level with item count", async () => {
    const { log, records } = makePinoCapture();
    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        log,
        client: fromAny({ savePantryItems: mockSavePantryItems, notifySync: mockNotifySync }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [] },
    );
    registerAddPantryItemsTool(server, ctx);

    await callTool("add_pantry_items", { items: [{ ingredient: "Butter" }, { ingredient: "Eggs" }] });

    const invocation = records.find((r) => r["msg"] === "tool invoked");
    expect(invocation).toBeDefined();
    expect(invocation?.["tool"]).toBe("add_pantry_items");
    expect(invocation?.["count"]).toBe(2);
    expect(invocation?.["level"]).toBe(30); // pino info = 30
  });

  it("pantry-batch.13: optional fields flow through correctly", async () => {
    const { callTool } = makeAddCtx();

    await callTool("add_pantry_items", {
      items: [
        {
          ingredient: "Apples",
          quantity: "6",
          aisle: "Produce",
          inStock: false,
        },
      ],
    });

    const [savedItem] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(savedItem?.ingredient).toBe("Apples");
    expect(savedItem?.quantity).toBe("6");
    expect(savedItem?.aisle).toBe("Produce");
    expect(savedItem?.aisleUid).toBe("AISLE-1");
    expect(savedItem?.inStock).toBe(false);
    expect(savedItem?.notes).toBe(null);
  });

  it("pantry-batch.14: mixed duplicates and valid items — correct split in response", async () => {
    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        aisleStore,
        client: fromAny({
          savePantryItems: mockSavePantryItems,
          saveAisle: mockSaveAisle,
          notifySync: mockNotifySync,
        }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [makePantryItem({ ingredient: "Butter", uid: "UID-BT" as PantryItemUid })] },
    );
    registerAddPantryItemsTool(server, ctx);

    const result = await callTool("add_pantry_items", {
      items: [
        { ingredient: "Eggs" },
        { ingredient: "butter" }, // dupe
        { ingredient: "Milk" },
      ],
    });
    const text = getText(result);

    expect(text).toContain("Added 2 item(s)");
    expect(text).toContain("UID-BT");
    expect(text).toContain("Skipped");
    const savedItems: Array<{ ingredient: string }> = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(savedItems).toHaveLength(2);
    expect(savedItems.map((i) => i.ingredient)).toEqual(["Eggs", "Milk"]);
  });

  it("pantry-batch.15: unknown aisle auto-created and UID threaded through", async () => {
    const newAisle = makeAisle({ name: "Exotic", uid: "AISLE-EX" as AisleUid });
    mockSaveAisle.mockResolvedValue(newAisle);
    const mockPutAisle = vi.fn().mockResolvedValue(undefined);
    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        aisleStore,
        client: fromAny({
          savePantryItems: mockSavePantryItems,
          saveAisle: mockSaveAisle,
          notifySync: mockNotifySync,
        }),
        cache: fromAny({
          pantry: { put: mockPutPantryItem },
          aisles: { put: mockPutAisle },
          flush: mockFlush,
        }),
      }),
      { pantry: [] },
    );
    registerAddPantryItemsTool(server, ctx);

    await callTool("add_pantry_items", { items: [{ ingredient: "Dragon Fruit", aisle: "Exotic" }] });

    expect(mockSaveAisle).toHaveBeenCalledOnce();
    const [savedItem] = mockSavePantryItems.mock.calls[0]?.[0] ?? [];
    expect(savedItem?.aisle).toBe("Exotic");
    expect(savedItem?.aisleUid).toBe("AISLE-EX");
  });
});
