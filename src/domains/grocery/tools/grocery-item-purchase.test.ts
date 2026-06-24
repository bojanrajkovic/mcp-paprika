import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroceryItemUid, GroceryListUid } from "../ids.js";
import type { GroceryState } from "../module.js";

import { makeGroceryItem } from "../../../../test/domains/grocery/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../../test/domains/grocery/__fixtures__/grocery-lists.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getJson, getText } from "../../../../test/support/tool-test-utils.js";
import { markGroceryItemPurchasedInputSchema } from "./grocery-item-purchase.js";

const WEEKLY_LIST = makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" });

describe("mark_grocery_item_purchased tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("marks an unpurchased item as purchased and returns markdown", async () => {
    const item = makeGroceryItem({
      uid: "ITEM-1" as GroceryItemUid,
      ingredient: "Milk",
      listUid: "LIST-1",
      purchased: false,
    });
    vi.mocked(kh.client().saveGroceryItems).mockReturnValue(okAsync([{ ...item, purchased: true }]));
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    const result = await kh.callTool("mark_grocery_item_purchased", { uid: "ITEM-1" });
    const json = getJson<{ uid: string; ingredient: string; purchased: boolean }>(result);

    expect(json.ingredient).toBe("Milk");
    expect(json.purchased).toBe(true); // purchased: true in JSON
    expect(kh.client().saveGroceryItems).toHaveBeenCalledWith([expect.objectContaining({ purchased: true })]);
    // The purchased row rides structuredContent so the model can chain on its UID.
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as { uid: string; purchased: boolean };
    expect(structured.uid).toBe("ITEM-1");
    expect(structured.purchased).toBe(true);
  });

  it("unknown uid returns not-found error without calling the client", async () => {
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [] });

    const result = await kh.callTool("mark_grocery_item_purchased", { uid: "UNKNOWN-UID" });

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("No grocery item found with UID");
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
    vi.mocked(kh.client().saveGroceryItems).mockReturnValue(okAsync([savedItem]));
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    await kh.callTool("mark_grocery_item_purchased", { uid: "ITEM-2" });

    const state = kh.state();
    expect(state.items.store.get("ITEM-2" as GroceryItemUid)).toEqual(expect.objectContaining({ purchased: true }));
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("cold-start guard fires when stores have not synced", async () => {
    // stores never seeded — hasSynced false
    const text = await kh.callToolText("mark_grocery_item_purchased", { uid: "ITEM-1" });

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("returns an error message when saveGroceryItems errs", async () => {
    const item = makeGroceryItem({
      uid: "ITEM-3" as GroceryItemUid,
      ingredient: "Butter",
      listUid: "LIST-1",
      purchased: false,
    });
    vi.mocked(kh.client().saveGroceryItems).mockReturnValue(errAsync(new Error("Network error")));
    kh.seed({ groceryLists: [WEEKLY_LIST], groceryItems: [item] });

    const result = await kh.callTool("mark_grocery_item_purchased", { uid: "ITEM-3" });

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Failed to mark grocery item purchased");
    expect(getText(result)).toContain("Network error");
  });
});
