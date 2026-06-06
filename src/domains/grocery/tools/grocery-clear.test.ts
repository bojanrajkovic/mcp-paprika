import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroceryItemUid, GroceryListUid } from "../ids.js";
import type { GroceryState } from "../module.js";

import { makeGroceryItem } from "../../../../test/domains/grocery/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../../test/domains/grocery/__fixtures__/grocery-lists.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

const WEEKLY_LIST = makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" });

describe("clear_purchased_grocery_items tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("clears only purchased items, leaving unpurchased intact", async () => {
    const purchasedItem1 = makeGroceryItem({
      uid: "ITEM-P1" as GroceryItemUid,
      ingredient: "Apples",
      listUid: "LIST-1",
      purchased: true,
    });
    const purchasedItem2 = makeGroceryItem({
      uid: "ITEM-P2" as GroceryItemUid,
      ingredient: "Milk",
      listUid: "LIST-1",
      purchased: true,
    });
    const unpurchasedItem = makeGroceryItem({
      uid: "ITEM-U1" as GroceryItemUid,
      ingredient: "Eggs",
      listUid: "LIST-1",
      purchased: false,
    });
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [purchasedItem1, purchasedItem2, unpurchasedItem] });
    vi.mocked(kh.client().saveGroceryItems).mockImplementation((items) => okAsync(items));

    const result = await kh.callTool("clear_purchased_grocery_items", { listUid: "LIST-1" });
    const text = getText(result);

    // Response mentions how many were cleared
    expect(text).toContain("2");
    expect(text.toLowerCase()).toContain("cleared");
    expect(text).toContain('"Weekly"');

    // saveGroceryItems called with only the 2 purchased items, both deleted: true
    expect(kh.client().saveGroceryItems).toHaveBeenCalledOnce();
    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      uid: string;
      deleted: boolean;
    }>;
    expect(savedItems).toHaveLength(2);
    const savedUids = savedItems.map((i) => i.uid).sort();
    expect(savedUids).toEqual(["ITEM-P1", "ITEM-P2"].sort());
    for (const item of savedItems) {
      expect(item.deleted).toBe(true);
    }

    // Purchased items removed from the store; unpurchased item remains
    const state = kh.state();
    expect(state.items.store.get("ITEM-P1" as GroceryItemUid)).toBeUndefined();
    expect(state.items.store.get("ITEM-P2" as GroceryItemUid)).toBeUndefined();
    expect(state.items.store.get("ITEM-U1" as GroceryItemUid)).toBeDefined();
  });

  it("returns informational message when no purchased items, saveGroceryItems NOT called", async () => {
    const unpurchasedItem = makeGroceryItem({
      uid: "ITEM-U1" as GroceryItemUid,
      ingredient: "Eggs",
      listUid: "LIST-1",
      purchased: false,
    });
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [unpurchasedItem] });

    const result = await kh.callTool("clear_purchased_grocery_items", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no purchased items to clear");
    expect(text).toContain('"Weekly"');
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("returns sync message when grocery stores not loaded", async () => {
    // Stores not seeded — hasSynced is false on both lists and items stores
    const result = await kh.callTool("clear_purchased_grocery_items", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("grocery data is not yet synced");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("invalid list UID returns not-found message without touching saves", async () => {
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [] });

    const result = await kh.callTool("clear_purchased_grocery_items", { listUid: "NEVER-EXISTED" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });
});

describe("clear_grocery_list tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("clears all items (purchased and unpurchased) via single batch POST", async () => {
    const items = [
      makeGroceryItem({
        uid: "ITEM-1" as GroceryItemUid,
        ingredient: "Apples",
        listUid: "LIST-1",
        purchased: true,
      }),
      makeGroceryItem({
        uid: "ITEM-2" as GroceryItemUid,
        ingredient: "Milk",
        listUid: "LIST-1",
        purchased: false,
      }),
      makeGroceryItem({
        uid: "ITEM-3" as GroceryItemUid,
        ingredient: "Eggs",
        listUid: "LIST-1",
        purchased: true,
      }),
    ];
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: items });
    vi.mocked(kh.client().saveGroceryItems).mockImplementation((i) => okAsync(i));

    const result = await kh.callTool("clear_grocery_list", { listUid: "LIST-1" });
    const text = getText(result);

    // Response mentions count and list name
    expect(text).toContain("3");
    expect(text.toLowerCase()).toContain("cleared");
    expect(text).toContain('"Weekly"');

    // Single batch POST with all 3 items, all deleted: true
    expect(kh.client().saveGroceryItems).toHaveBeenCalledOnce();
    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      uid: string;
      deleted: boolean;
    }>;
    expect(savedItems).toHaveLength(3);
    for (const item of savedItems) {
      expect(item.deleted).toBe(true);
    }

    // All items removed from the store
    const state = kh.state();
    expect(state.items.store.getByListUid("LIST-1" as GroceryListUid)).toHaveLength(0);
  });

  it("empty list returns informational message, saveGroceryItems NOT called", async () => {
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [] });

    const result = await kh.callTool("clear_grocery_list", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no items to clear");
    expect(text).toContain('"Weekly"');
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("returns sync message when grocery stores not loaded", async () => {
    // Stores not seeded — hasSynced is false on both lists and items stores
    const result = await kh.callTool("clear_grocery_list", { listUid: "LIST-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("grocery data is not yet synced");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("invalid list UID returns not-found message without touching saves", async () => {
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [] });

    const result = await kh.callTool("clear_grocery_list", { listUid: "NEVER-EXISTED" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery list found");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });
});
