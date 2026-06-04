import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroceryItemUid, GroceryListUid, PantryItemUid } from "../../ids.js";
import type { GrocerySelf } from "../module.js";

import { makeGroceryItem } from "../../../test/cache/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../test/cache/__fixtures__/grocery-lists.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";
import { getText } from "../../../test/support/tool-test-utils.js";
import { NO_AISLE_UID } from "../../ids.js";

const WEEKLY_LIST = makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" });

describe("move_grocery_items_to_pantry tool", () => {
  const kh = useKernelHarness("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("single UID creates pantry item then deletes grocery item", async () => {
    const item = makeGroceryItem({
      uid: "ITEM-1" as GroceryItemUid,
      ingredient: "Apples",
      aisle: "Produce",
      aisleUid: "AISLE-1",
      listUid: "LIST-1",
    });
    kh.seed({ pantry: [], groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    // savePantryItems must return items — pantry createItems uses the returned items
    vi.mocked(kh.client().savePantryItems).mockResolvedValue([
      {
        uid: "PANTRY-ITEM-1" as PantryItemUid,
        ingredient: "Apples",
        aisle: "Produce",
        aisleUid: NO_AISLE_UID,
        quantity: "",
        expirationDate: null,
        hasExpiration: false,
        inStock: true,
        purchaseDate: "2026-01-01 00:00:00",
        notes: null,
        deleted: false,
      },
    ]);
    vi.mocked(kh.client().saveGroceryItems).mockResolvedValue([{ ...item, deleted: true }]);

    const result = await kh.callTool("move_grocery_items_to_pantry", { uids: ["ITEM-1"] });
    const text = getText(result);

    // Response mentions ingredient and moved
    expect(text).toContain("Apples");
    expect(text.toLowerCase()).toContain("moved");

    // Pantry save called with correct fields
    expect(kh.client().savePantryItems).toHaveBeenCalledOnce();
    const savedPantryItems = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] as unknown as Array<{
      ingredient: string;
      aisle: string;
      aisleUid: string;
      quantity: string;
      deleted: boolean;
      inStock: boolean;
      expirationDate: null;
      hasExpiration: boolean;
    }>;
    expect(savedPantryItems).toHaveLength(1);
    const pantryItem = savedPantryItems[0];
    expect(pantryItem?.ingredient).toBe("Apples");
    expect(pantryItem?.aisle).toBe("Produce");
    expect(pantryItem?.aisleUid).toBe("AISLE-1");
    expect(pantryItem?.quantity).toBe("");
    expect(pantryItem?.deleted).toBe(false);
    expect(pantryItem?.inStock).toBe(true);
    expect(pantryItem?.expirationDate).toBeNull();
    expect(pantryItem?.hasExpiration).toBe(false);

    // purchaseDate is today in Paprika wire format
    const purchaseDateField = (savedPantryItems[0] as Record<string, unknown>)["purchaseDate"];
    expect(typeof purchaseDateField).toBe("string");
    expect(purchaseDateField).toMatch(/^\d{4}-\d{2}-\d{2} 00:00:00$/);

    // Grocery delete called with deleted:true
    expect(kh.client().saveGroceryItems).toHaveBeenCalledOnce();
    const savedGroceryItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as unknown as Array<{
      uid: string;
      deleted: boolean;
    }>;
    expect(savedGroceryItems).toHaveLength(1);
    const groceryItem = savedGroceryItems[0];
    expect(groceryItem?.uid).toBe("ITEM-1");
    expect(groceryItem?.deleted).toBe(true);

    // Create-first ordering: pantry save must be called before grocery delete
    const pantryCallOrder = vi.mocked(kh.client().savePantryItems).mock.invocationCallOrder[0];
    const groceryCallOrder = vi.mocked(kh.client().saveGroceryItems).mock.invocationCallOrder[0];
    expect(pantryCallOrder).toBeDefined();
    expect(groceryCallOrder).toBeDefined();
    expect(pantryCallOrder!).toBeLessThan(groceryCallOrder!);

    // Grocery item removed from the store (committed via commitGroceryItemsBatch)
    expect((kh.self() as GrocerySelf).items.store.get("ITEM-1" as GroceryItemUid)).toBeUndefined();
    expect((kh.self() as GrocerySelf).items.store.isTombstone("ITEM-1" as GroceryItemUid)).toBe(true);
  });

  it("batch of 3 UIDs calls savePantryItems once then saveGroceryItems once (create-first)", async () => {
    const items = [
      makeGroceryItem({ uid: "BATCH-1" as GroceryItemUid, ingredient: "Apples", listUid: "LIST-1" }),
      makeGroceryItem({ uid: "BATCH-2" as GroceryItemUid, ingredient: "Milk", listUid: "LIST-1" }),
      makeGroceryItem({ uid: "BATCH-3" as GroceryItemUid, ingredient: "Eggs", listUid: "LIST-1" }),
    ];
    kh.seed({ pantry: [], groceryLists: [WEEKLY_LIST], groceryItems: items });

    vi.mocked(kh.client().savePantryItems).mockResolvedValue(
      items.map((item, i) => ({
        uid: `PANTRY-BATCH-${(i + 1).toString()}` as PantryItemUid,
        ingredient: item.ingredient,
        aisle: "",
        aisleUid: NO_AISLE_UID,
        quantity: "",
        expirationDate: null,
        hasExpiration: false,
        inStock: true,
        purchaseDate: "2026-01-01 00:00:00",
        notes: null,
        deleted: false,
      })),
    );
    vi.mocked(kh.client().saveGroceryItems).mockResolvedValue(items.map((gi) => ({ ...gi, deleted: true })));

    const result = await kh.callTool("move_grocery_items_to_pantry", {
      uids: ["BATCH-1", "BATCH-2", "BATCH-3"],
    });
    const text = getText(result);
    expect(text.toLowerCase()).toContain("moved");

    // Single batch save for pantry
    expect(kh.client().savePantryItems).toHaveBeenCalledOnce();
    const savedPantryBatch = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] as Array<unknown>;
    expect(savedPantryBatch).toHaveLength(3);

    // Single batch save for grocery delete
    expect(kh.client().saveGroceryItems).toHaveBeenCalledOnce();
    const savedGroceryBatch = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as unknown as Array<{
      deleted: boolean;
    }>;
    expect(savedGroceryBatch).toHaveLength(3);
    for (const gi of savedGroceryBatch) {
      expect(gi.deleted).toBe(true);
    }

    // Create-first ordering: pantry save before grocery delete
    const pantryCallOrder = vi.mocked(kh.client().savePantryItems).mock.invocationCallOrder[0];
    const groceryCallOrder = vi.mocked(kh.client().saveGroceryItems).mock.invocationCallOrder[0];
    expect(pantryCallOrder!).toBeLessThan(groceryCallOrder!);

    // All three grocery items tombstoned in the store
    const grocerySelf = kh.self() as GrocerySelf;
    expect(grocerySelf.items.store.isTombstone("BATCH-1" as GroceryItemUid)).toBe(true);
    expect(grocerySelf.items.store.isTombstone("BATCH-2" as GroceryItemUid)).toBe(true);
    expect(grocerySelf.items.store.isTombstone("BATCH-3" as GroceryItemUid)).toBe(true);
  });

  it("tombstoned UID returns already-deleted without calling saves", async () => {
    const item = makeGroceryItem({ uid: "TOMB-1" as GroceryItemUid, ingredient: "Milk" });
    kh.seed({ pantry: [], groceryLists: [WEEKLY_LIST], groceryItems: [item] });
    // Create tombstone by deleting after seeding
    (kh.self() as GrocerySelf).items.store.delete("TOMB-1" as GroceryItemUid);

    const result = await kh.callTool("move_grocery_items_to_pantry", { uids: ["TOMB-1"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("already deleted");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("partial failure returns structured message with created pantry UIDs", async () => {
    const item = makeGroceryItem({
      uid: "PFAIL-1" as GroceryItemUid,
      ingredient: "Butter",
      listUid: "LIST-1",
    });
    kh.seed({ pantry: [], groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    // Pantry save succeeds
    vi.mocked(kh.client().savePantryItems).mockResolvedValue([
      {
        uid: "PANTRY-UID-PFAIL" as PantryItemUid,
        ingredient: "Butter",
        aisle: "",
        aisleUid: NO_AISLE_UID,
        quantity: "",
        expirationDate: null,
        hasExpiration: false,
        inStock: true,
        purchaseDate: "2026-01-01 00:00:00",
        notes: null,
        deleted: false,
      },
    ]);
    // Grocery delete fails
    vi.mocked(kh.client().saveGroceryItems).mockRejectedValue(new Error("network timeout"));

    const result = await kh.callTool("move_grocery_items_to_pantry", { uids: ["PFAIL-1"] });
    const text = getText(result);

    // Response mentions partial failure
    expect(text.toLowerCase()).toContain("partial failure");
    // Mentions that pantry items were created
    expect(text.toLowerCase()).toContain("pantry item(s) were created");
    // Mentions the failure reason
    expect(text.toLowerCase()).toContain("network timeout");
    // Pantry UIDs included
    expect(text.toLowerCase()).toContain("uids:");

    // Pantry save was called and succeeded
    expect(kh.client().savePantryItems).toHaveBeenCalledOnce();
    // Grocery save was called and failed
    expect(kh.client().saveGroceryItems).toHaveBeenCalledOnce();
    // Grocery item NOT tombstoned (failed grocery delete)
    expect((kh.self() as GrocerySelf).items.store.get("PFAIL-1" as GroceryItemUid)).toBeDefined();
  });

  it("pantry-not-synced guard returns pantry sync message", async () => {
    // grocery stores synced, pantry omitted → hasSynced false
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [] });

    const result = await kh.callTool("move_grocery_items_to_pantry", { uids: ["ITEM-1"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("pantry is not yet synced");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("grocery-not-synced guard returns grocery sync message", async () => {
    // pantry synced, grocery omitted → groceryStartGuard fires
    kh.seed({ pantry: [] });

    const result = await kh.callTool("move_grocery_items_to_pantry", { uids: ["ITEM-1"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("grocery data is not yet synced");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("unknown UID returns not-found message without touching saves", async () => {
    kh.seed({ pantry: [], groceryLists: [WEEKLY_LIST], groceryItems: [] });

    const result = await kh.callTool("move_grocery_items_to_pantry", { uids: ["NEVER-EXISTED"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery item found");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("duplicate UIDs are deduplicated — only one pantry item created per unique UID", async () => {
    const item = makeGroceryItem({
      uid: "DUP-1" as GroceryItemUid,
      ingredient: "Butter",
      listUid: "LIST-1",
    });
    kh.seed({ pantry: [], groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    vi.mocked(kh.client().savePantryItems).mockResolvedValue([
      {
        uid: "PANTRY-DUP" as PantryItemUid,
        ingredient: "Butter",
        aisle: "",
        aisleUid: NO_AISLE_UID,
        quantity: "",
        expirationDate: null,
        hasExpiration: false,
        inStock: true,
        purchaseDate: "2026-01-01 00:00:00",
        notes: null,
        deleted: false,
      },
    ]);
    vi.mocked(kh.client().saveGroceryItems).mockResolvedValue([{ ...item, deleted: true }]);

    const result = await kh.callTool("move_grocery_items_to_pantry", { uids: ["DUP-1", "DUP-1", "DUP-1"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("moved");
    expect(kh.client().savePantryItems).toHaveBeenCalledOnce();
    const savedPantry = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] as Array<unknown>;
    expect(savedPantry).toHaveLength(1);
    expect(kh.client().saveGroceryItems).toHaveBeenCalledOnce();
    const savedGrocery = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as Array<unknown>;
    expect(savedGrocery).toHaveLength(1);
  });

  it("pantry-create failure returns structured error without deleting grocery items", async () => {
    const item = makeGroceryItem({
      uid: "PFAIL-3" as GroceryItemUid,
      ingredient: "Chicken",
      listUid: "LIST-1",
    });
    kh.seed({ pantry: [], groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    vi.mocked(kh.client().savePantryItems).mockRejectedValue(new Error("pantry API down"));

    const result = await kh.callTool("move_grocery_items_to_pantry", { uids: ["PFAIL-3"] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("failed to create pantry items");
    expect(text.toLowerCase()).toContain("pantry api down");
    expect(text.toLowerCase()).toContain("no grocery items were deleted");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
    // Grocery item still present (not deleted)
    expect((kh.self() as GrocerySelf).items.store.get("PFAIL-3" as GroceryItemUid)).toBeDefined();
  });

  it("partial failure message includes the pantry UIDs returned by savePantryItems", async () => {
    const item = makeGroceryItem({
      uid: "PFAIL-2" as GroceryItemUid,
      ingredient: "Cheese",
      listUid: "LIST-1",
    });
    kh.seed({ pantry: [], groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    const knownPantryUid = "PANTRY-UID-KNOWN" as PantryItemUid;
    vi.mocked(kh.client().savePantryItems).mockResolvedValue([
      {
        uid: knownPantryUid,
        ingredient: "Cheese",
        aisle: "",
        aisleUid: NO_AISLE_UID,
        quantity: "",
        expirationDate: null,
        hasExpiration: false,
        inStock: true,
        purchaseDate: "2026-01-01 00:00:00",
        notes: null,
        deleted: false,
      },
    ]);
    vi.mocked(kh.client().saveGroceryItems).mockRejectedValue(new Error("server error"));

    const result = await kh.callTool("move_grocery_items_to_pantry", { uids: ["PFAIL-2"] });
    const text = getText(result);

    expect(text).toContain("PANTRY-UID-KNOWN");
  });
});
