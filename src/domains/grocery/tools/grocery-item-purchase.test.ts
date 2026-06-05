import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroceryItemUid, GroceryListUid } from "../../../ids.js";
import type { GroceryState } from "../module.js";

import { makeGroceryItem } from "../../../../test/cache/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../../test/cache/__fixtures__/grocery-lists.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { markGroceryItemPurchasedInputSchema } from "./grocery-item-purchase.js";

const WEEKLY_LIST = makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" });

describe("mark_grocery_item_purchased tool", () => {
  const kh = useKernelHarness("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("marks an unpurchased item as purchased and returns markdown", async () => {
    const item = makeGroceryItem({
      uid: "ITEM-1" as GroceryItemUid,
      ingredient: "Milk",
      listUid: "LIST-1",
      purchased: false,
    });
    vi.mocked(kh.client().saveGroceryItems).mockResolvedValue([{ ...item, purchased: true }]);
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    const text = getText(await kh.callTool("mark_grocery_item_purchased", { uid: "ITEM-1" }));

    expect(text).toContain("Milk");
    expect(text).toContain("Yes"); // Purchased: Yes
    expect(kh.client().saveGroceryItems).toHaveBeenCalledWith([expect.objectContaining({ purchased: true })]);
  });

  it("unknown uid returns not-found error without calling the client", async () => {
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [] });

    const text = getText(await kh.callTool("mark_grocery_item_purchased", { uid: "UNKNOWN-UID" }));

    expect(text).toContain("No grocery item found with UID");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("purchased field is rejected by the input schema", () => {
    expect(markGroceryItemPurchasedInputSchema.safeParse({ uid: "X", purchased: true }).success).toBe(false);
  });

  it("commits the updated item to the store (Content entity fires resourceListChanged)", async () => {
    const item = makeGroceryItem({
      uid: "ITEM-2" as GroceryItemUid,
      ingredient: "Eggs",
      listUid: "LIST-1",
      purchased: false,
    });
    const savedItem = { ...item, purchased: true };
    vi.mocked(kh.client().saveGroceryItems).mockResolvedValue([savedItem]);
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    await kh.callTool("mark_grocery_item_purchased", { uid: "ITEM-2" });

    const state = kh.state() as GroceryState;
    expect(state.items.store.get("ITEM-2" as GroceryItemUid)).toEqual(expect.objectContaining({ purchased: true }));
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("cold-start guard fires when stores have not synced", async () => {
    // stores never seeded — hasSynced false
    const text = getText(await kh.callTool("mark_grocery_item_purchased", { uid: "ITEM-1" }));

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("returns an error message when saveGroceryItems throws", async () => {
    const item = makeGroceryItem({
      uid: "ITEM-3" as GroceryItemUid,
      ingredient: "Butter",
      listUid: "LIST-1",
      purchased: false,
    });
    vi.mocked(kh.client().saveGroceryItems).mockRejectedValue(new Error("Network error"));
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    const text = getText(await kh.callTool("mark_grocery_item_purchased", { uid: "ITEM-3" }));

    expect(text).toContain("Failed to mark grocery item purchased");
    expect(text).toContain("Network error");
  });
});
