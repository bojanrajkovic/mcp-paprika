import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import type { PantryItemUid } from "../ids.js";

import { makePantryItem } from "../../test/cache/__fixtures__/pantry.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { PaprikaAPIError } from "../paprika/errors.js";
import { RecipeStore } from "../recipe/store.js";
import {
  markPantryItemOutOfStockInputSchema,
  registerMarkPantryItemOutOfStockTool,
  registerRestockPantryItemTool,
  restockPantryItemInputSchema,
} from "./pantry-stock.js";

describe("pantry-stock: mark_pantry_item_out_of_stock tool", () => {
  it("happy path: marks an in-stock item as out of stock", async () => {
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      ingredient: "Milk",
      inStock: true,
    });

    const saveSpy = vi
      .fn()
      .mockImplementation(async (items: ReadonlyArray<unknown>) =>
        (items as Array<{ inStock: boolean } & typeof item>).map((i) => ({ ...i, inStock: false })),
      );
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({ savePantryItems: saveSpy, notifySync: mockNotifySync }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [item] },
    );
    registerMarkPantryItemOutOfStockTool(server, ctx);

    const result = await callTool("mark_pantry_item_out_of_stock", { uid: "uid-1" });
    const text = getText(result);

    expect(text).toContain("Milk");
    expect(text).toContain("**In stock:** No");
    expect(saveSpy).toHaveBeenCalledWith([expect.objectContaining({ inStock: false })]);
  });

  it("not-found: unknown uid returns no-item-found message", async () => {
    const saveSpy = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({ savePantryItems: saveSpy, notifySync: mockNotifySync }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [] },
    );
    registerMarkPantryItemOutOfStockTool(server, ctx);

    const result = await callTool("mark_pantry_item_out_of_stock", { uid: "missing" });
    const text = getText(result);

    expect(text).toContain('No pantry item found with UID "missing".');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("schema hard-reject: inStock field rejected on markPantryItemOutOfStockInputSchema", () => {
    expect(markPantryItemOutOfStockInputSchema.safeParse({ uid: "X", inStock: false }).success).toBe(false);
  });

  it("save error: returns error message, cache/store not mutated", async () => {
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      ingredient: "Eggs",
      inStock: true,
    });

    const saveSpy = vi.fn().mockRejectedValue(new PaprikaAPIError("server timeout", 500, "https://example/api"));
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({ savePantryItems: saveSpy, notifySync: mockNotifySync }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [item] },
    );
    registerMarkPantryItemOutOfStockTool(server, ctx);

    const result = await callTool("mark_pantry_item_out_of_stock", { uid: "uid-1" });
    const text = getText(result);

    expect(text).toContain("Failed to update pantry item");
    expect(text).toContain("server timeout");
    expect(mockPutPantryItem).not.toHaveBeenCalled();
  });

  it("cold-start guard blocks call before pantry synced", async () => {
    const saveSpy = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    // pantryStore not seeded → hasSynced === false
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ savePantryItems: saveSpy, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerMarkPantryItemOutOfStockTool(server, ctx);

    const result = await callTool("mark_pantry_item_out_of_stock", { uid: "uid-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(saveSpy).not.toHaveBeenCalled();
  });
});

describe("pantry-stock: restock_pantry_item tool", () => {
  it("happy path: marks an out-of-stock item as in stock", async () => {
    const item = makePantryItem({
      uid: "uid-2" as PantryItemUid,
      ingredient: "Butter",
      inStock: false,
    });

    const saveSpy = vi
      .fn()
      .mockImplementation(async (items: ReadonlyArray<unknown>) =>
        (items as Array<{ inStock: boolean } & typeof item>).map((i) => ({ ...i, inStock: true })),
      );
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({ savePantryItems: saveSpy, notifySync: mockNotifySync }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [item] },
    );
    registerRestockPantryItemTool(server, ctx);

    const result = await callTool("restock_pantry_item", { uid: "uid-2" });
    const text = getText(result);

    expect(text).toContain("Butter");
    expect(text).toContain("**In stock:** Yes");
    expect(saveSpy).toHaveBeenCalledWith([expect.objectContaining({ inStock: true })]);
  });

  it("not-found: unknown uid returns no-item-found message", async () => {
    const saveSpy = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({ savePantryItems: saveSpy, notifySync: mockNotifySync }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [] },
    );
    registerRestockPantryItemTool(server, ctx);

    const result = await callTool("restock_pantry_item", { uid: "missing" });
    const text = getText(result);

    expect(text).toContain('No pantry item found with UID "missing".');
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("schema hard-reject: inStock field rejected on restockPantryItemInputSchema", () => {
    expect(restockPantryItemInputSchema.safeParse({ uid: "X", inStock: true }).success).toBe(false);
  });

  it("save error: returns error message, cache/store not mutated", async () => {
    const item = makePantryItem({
      uid: "uid-2" as PantryItemUid,
      ingredient: "Cheese",
      inStock: false,
    });

    const saveSpy = vi.fn().mockRejectedValue(new PaprikaAPIError("server timeout", 500, "https://example/api"));
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    const ctx = seed(
      makeCtx(new RecipeStore(), server, {
        client: fromAny({ savePantryItems: saveSpy, notifySync: mockNotifySync }),
        cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
      }),
      { pantry: [item] },
    );
    registerRestockPantryItemTool(server, ctx);

    const result = await callTool("restock_pantry_item", { uid: "uid-2" });
    const text = getText(result);

    expect(text).toContain("Failed to update pantry item");
    expect(text).toContain("server timeout");
    expect(mockPutPantryItem).not.toHaveBeenCalled();
  });

  it("cold-start guard blocks call before pantry synced", async () => {
    const saveSpy = vi.fn();
    const mockNotifySync = vi.fn().mockResolvedValue(undefined);
    const mockPutPantryItem = vi.fn();
    const mockFlush = vi.fn().mockResolvedValue(undefined);

    const { server, callTool } = makeTestServer();
    // pantryStore not seeded → hasSynced === false
    const ctx = makeCtx(new RecipeStore(), server, {
      client: fromAny({ savePantryItems: saveSpy, notifySync: mockNotifySync }),
      cache: fromAny({ pantry: { put: mockPutPantryItem }, flush: mockFlush }),
    });
    registerRestockPantryItemTool(server, ctx);

    const result = await callTool("restock_pantry_item", { uid: "uid-2" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
