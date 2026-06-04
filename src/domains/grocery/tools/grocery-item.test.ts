import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AisleUid, GroceryItemUid, GroceryListUid } from "../../../ids.js";
import type { GrocerySelf } from "../module.js";

import { makeAisle } from "../../../../test/cache/__fixtures__/aisles.js";
import { makeGroceryIngredient } from "../../../../test/cache/__fixtures__/grocery-ingredients.js";
import { makeGroceryItem } from "../../../../test/cache/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../../test/cache/__fixtures__/grocery-lists.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { updateGroceryItemInputSchema } from "./grocery-item.js";

const WEEKLY_LIST = makeGroceryList({ uid: "LIST-1" as GroceryListUid, name: "Weekly" });
const PRODUCE_AISLE = makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" });
const BUTTER_INGREDIENT = makeGroceryIngredient({ name: "Butter", aisleUid: "AISLE-1" });

describe("add_grocery_items tool", () => {
  const kh = useKernelHarness("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("single item with quantity creates name as 'quantity ingredient'", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [BUTTER_INGREDIENT],
    });

    const result = await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Chicken", quantity: "2 lbs" }],
    });
    const text = getText(result);

    expect(text).toContain("Chicken");
    expect(kh.client().saveGroceryItems).toHaveBeenCalledOnce();

    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      name: string;
      ingredient: string;
      quantity: string;
    }>;
    expect(savedItems).toHaveLength(1);
    const item = savedItems[0];
    expect(item?.name).toBe("2 lbs Chicken");
    expect(item?.ingredient).toBe("Chicken");
    expect(item?.quantity).toBe("2 lbs");
  });

  it("single item with empty quantity creates name as just ingredient", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [BUTTER_INGREDIENT],
    });

    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Butter" }],
    });

    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      name: string;
      ingredient: string;
    }>;
    expect(savedItems).toHaveLength(1);
    const item = savedItems[0];
    expect(item?.name).toBe("Butter");
    expect(item?.ingredient).toBe("Butter");
  });

  it("batch of 3 items calls saveGroceryItems once with all 3 and commits them to the store", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [BUTTER_INGREDIENT],
    });

    const result = await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [
        { ingredient: "Apples", quantity: "6" },
        { ingredient: "Milk", quantity: "1 gallon" },
        { ingredient: "Eggs", quantity: "1 dozen" },
      ],
    });
    const text = getText(result);

    expect(text).toContain("Apples");
    expect(text).toContain("Milk");
    expect(text).toContain("Eggs");

    // Single batch POST
    expect(kh.client().saveGroceryItems).toHaveBeenCalledOnce();
    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as Array<unknown>;
    expect(savedItems).toHaveLength(3);

    // All 3 items committed to the store
    const self = kh.self() as GrocerySelf;
    expect(self.items.store.getByListUid("LIST-1" as GroceryListUid)).toHaveLength(3);
  });

  it("auto-resolves aisle from ingredient catalog when aisle omitted", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [BUTTER_INGREDIENT],
    });

    // "Butter" is in the ingredient catalog with aisleUid "AISLE-1" → "Produce"
    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Butter" }],
    });

    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      aisle: string;
      aisleUid: string;
    }>;
    const item = savedItems[0];
    // Should have resolved aisle from catalog
    expect(item?.aisle).toBe("Produce");
    expect(item?.aisleUid).toBe("AISLE-1");

    // Should NOT call saveGroceryIngredient when no explicit aisle provided
    expect(kh.client().saveGroceryIngredient).not.toHaveBeenCalled();
  });

  it("uses empty aisle strings when ingredient not in catalog and aisle omitted", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [BUTTER_INGREDIENT],
    });

    // "Unknown Spice" is NOT in the ingredient catalog
    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Unknown Spice" }],
    });

    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      aisle: string;
      aisleUid: string;
    }>;
    const item = savedItems[0];
    expect(item?.aisle).toBe("");
    expect(item?.aisleUid).toBe("");
  });

  it("explicit aisle uses ensureAisle and updates ingredient catalog", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    vi.mocked(kh.client().saveGroceryIngredient).mockImplementation(async (ing) => ing);
    vi.mocked(kh.client().saveAisle).mockImplementation(async (a) => a);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [BUTTER_INGREDIENT],
    });

    // "Butter" is already in catalog with "AISLE-1" (Produce)
    // Providing explicit aisle "Dairy" should:
    //   1. Call ensureAisle (create "Dairy" aisle since it doesn't exist)
    //   2. Update the catalog entry for "Butter" with new aisleUid
    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Butter", aisle: "Dairy" }],
    });

    // saveGroceryIngredient should be called to update the catalog entry
    expect(kh.client().saveGroceryIngredient).toHaveBeenCalledOnce();
    const savedIngredient = vi.mocked(kh.client().saveGroceryIngredient).mock.calls[0]?.[0] as {
      name: string;
      aisleUid: string;
    };
    expect(savedIngredient?.name).toBe("Butter");
    // The aisleUid should be the new "Dairy" aisle's UID (not "AISLE-1")
    expect(savedIngredient?.aisleUid).not.toBe("AISLE-1");
  });

  it("invalid listUid returns error without calling saveGroceryItems", async () => {
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [BUTTER_INGREDIENT],
    });

    const result = await kh.callTool("add_grocery_items", {
      listUid: "NONEXISTENT",
      items: [{ ingredient: "Butter" }],
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not found");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("batch with empty ingredient rejects entire batch before API calls", async () => {
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [BUTTER_INGREDIENT],
    });

    // An empty ingredient string should be rejected — all-or-nothing
    const result = await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [
        { ingredient: "Apples" },
        { ingredient: "" }, // invalid
      ],
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("invalid");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("in-batch aisle inference: later item without aisle inherits from earlier item with explicit aisle", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    vi.mocked(kh.client().saveGroceryIngredient).mockImplementation(async (ing) => ing);
    vi.mocked(kh.client().saveAisle).mockImplementation(async (a) => a);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [],
    });

    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Milk", aisle: "Produce" }, { ingredient: "Milk" }],
    });

    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      ingredient: string;
      aisle: string;
    }>;
    expect(savedItems).toHaveLength(2);
    expect(savedItems[0]?.aisle).toBe("Produce");
    expect(savedItems[1]?.aisle).toBe("Produce");
  });

  it("duplicate ingredient with explicit aisle calls saveGroceryIngredient only once per ingredient", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    vi.mocked(kh.client().saveGroceryIngredient).mockImplementation(async (ing) => ing);
    vi.mocked(kh.client().saveAisle).mockImplementation(async (a) => a);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [BUTTER_INGREDIENT],
    });

    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [
        { ingredient: "Chicken", aisle: "Meat" },
        { ingredient: "Chicken", aisle: "Meat" },
        { ingredient: "Chicken", aisle: "Meat" },
      ],
    });

    const ingredientCalls = vi
      .mocked(kh.client().saveGroceryIngredient)
      .mock.calls.filter((call) => (call[0] as { name: string }).name === "Chicken");
    expect(ingredientCalls).toHaveLength(1);
  });

  it("cross-invocation: explicit aisle in first call is auto-resolved in second call via updated store", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    vi.mocked(kh.client().saveGroceryIngredient).mockImplementation(async (ing) => ing);
    vi.mocked(kh.client().saveAisle).mockImplementation(async (a) => a);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [],
    });

    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Tofu", aisle: "Deli" }],
    });

    vi.mocked(kh.client().saveGroceryItems).mockClear();

    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Tofu" }],
    });

    const secondCallItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      aisle: string;
    }>;
    expect(secondCallItems).toHaveLength(1);
    expect(secondCallItems[0]?.aisle).toBe("Deli");
  });

  it("assigns the Miscellaneous aisle when no aisle is specified and there is no catalog match", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE, makeAisle({ uid: "AISLE-MISC" as AisleUid, name: "Miscellaneous" })],
      groceryIngredients: [], // no catalog memory for "bundt pan"
    });

    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "bundt pan" }],
    });

    const posted = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      aisle: string;
      aisleUid: string;
    }>;
    expect(posted).toHaveLength(1);
    expect(posted[0]?.aisle).toBe("Miscellaneous");
    expect(posted[0]?.aisleUid).toBe("AISLE-MISC");
    // Miscellaneous is a default placement, not learned memory — no catalog entry is written.
    expect(kh.client().saveGroceryIngredient).not.toHaveBeenCalled();
  });

  it("falls back to empty aisle when no aisle, no catalog match, and no Miscellaneous aisle exists", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    // Only "Produce" — no Miscellaneous in the catalog.
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [],
    });

    await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "bundt pan" }],
    });

    const posted = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      aisle: string;
      aisleUid: string;
    }>;
    expect(posted[0]?.aisle).toBe("");
    expect(posted[0]?.aisleUid).toBe("");
  });

  it("sync-not-ready blocks add_grocery_items when stores not loaded", async () => {
    // Grocery stores omitted from seed → hasSynced false
    kh.seed({ aisles: [PRODUCE_AISLE], groceryIngredients: [BUTTER_INGREDIENT] });

    const result = await kh.callTool("add_grocery_items", {
      listUid: "LIST-1",
      items: [{ ingredient: "Butter" }],
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });
});

describe("update_grocery_item tool", () => {
  const kh = useKernelHarness("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("partial merge updates only provided fields", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    const existingItem = makeGroceryItem({
      uid: "ITEM-1" as GroceryItemUid,
      ingredient: "Apples",
      quantity: "6",
      aisle: "Produce",
      aisleUid: "AISLE-1",
      listUid: "LIST-1",
      purchased: false,
      instruction: "get the green ones",
    });
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [existingItem],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [],
    });

    const result = await kh.callTool("update_grocery_item", {
      uid: "ITEM-1",
      quantity: "10",
    });
    const text = getText(result);
    expect(text).toContain("Apples");

    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      ingredient: string;
      quantity: string;
      aisle: string;
      aisleUid: string;
      purchased: boolean;
      instruction: string;
    }>;
    const saved = savedItems[0];

    // Only quantity changed
    expect(saved?.quantity).toBe("10");
    // All others unchanged from baseline
    expect(saved?.ingredient).toBe("Apples");
    expect(saved?.aisle).toBe("Produce");
    expect(saved?.aisleUid).toBe("AISLE-1");
    expect(saved?.purchased).toBe(false);
    expect(saved?.instruction).toBe("get the green ones");
  });

  it("purchased is rejected — promoted to mark_grocery_item_purchased", () => {
    // The `purchased` transition left update_grocery_item for its own intent verb.
    // The strict schema rejects a stray `purchased` key rather than silently dropping it.
    expect(updateGroceryItemInputSchema.safeParse({ uid: "ITEM-2", purchased: true }).success).toBe(false);
  });

  it("name recalculated when quantity changes from empty to non-empty", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    const existingItem = makeGroceryItem({
      uid: "ITEM-3" as GroceryItemUid,
      ingredient: "Chicken",
      quantity: "",
      name: "Chicken",
    });
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [existingItem],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [],
    });

    await kh.callTool("update_grocery_item", {
      uid: "ITEM-3",
      quantity: "2 lbs",
    });

    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      name: string;
      quantity: string;
    }>;
    const saved = savedItems[0];
    expect(saved?.name).toBe("2 lbs Chicken");
    expect(saved?.quantity).toBe("2 lbs");
  });

  it("name recalculated when quantity changes from non-empty to empty", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    const existingItem = makeGroceryItem({
      uid: "ITEM-4" as GroceryItemUid,
      ingredient: "Chicken",
      quantity: "2 lbs",
      name: "2 lbs Chicken",
    });
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [existingItem],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [],
    });

    await kh.callTool("update_grocery_item", {
      uid: "ITEM-4",
      quantity: "",
    });

    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      name: string;
      quantity: string;
    }>;
    const saved = savedItems[0];
    expect(saved?.name).toBe("Chicken");
    expect(saved?.quantity).toBe("");
  });

  it("unknown UID returns error and does not call saveGroceryItems", async () => {
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [PRODUCE_AISLE],
      groceryIngredients: [],
    });

    const result = await kh.callTool("update_grocery_item", {
      uid: "NONEXISTENT-UID",
      quantity: "5",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery item found");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("sync-not-ready blocks update_grocery_item when stores not loaded", async () => {
    // Grocery stores omitted → hasSynced false
    kh.seed({ aisles: [PRODUCE_AISLE], groceryIngredients: [] });

    const result = await kh.callTool("update_grocery_item", {
      uid: "ITEM-1",
      quantity: "5",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });
});

describe("delete_grocery_item tool", () => {
  const kh = useKernelHarness("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("delete existing item sets deleted:true and commits", async () => {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(async (items) => items);
    const existingItem = makeGroceryItem({
      uid: "ITEM-DEL-1" as GroceryItemUid,
      ingredient: "Milk",
      listUid: "LIST-1",
      deleted: false,
    });
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [existingItem],
      aisles: [],
      groceryIngredients: [],
    });

    const result = await kh.callTool("delete_grocery_item", {
      uid: "ITEM-DEL-1",
    });
    const text = getText(result);

    // Response should confirm deletion
    expect(text.toLowerCase()).toContain("deleted");
    expect(text).toContain("Milk");

    // saveGroceryItems called with deleted:true
    expect(kh.client().saveGroceryItems).toHaveBeenCalledOnce();
    const savedItems = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      uid: string;
      deleted: boolean;
    }>;
    expect(savedItems).toHaveLength(1);
    const saved = savedItems[0];
    expect(saved?.deleted).toBe(true);
    expect(saved?.uid).toBe("ITEM-DEL-1");

    // Item is removed from the store
    const self = kh.self() as GrocerySelf;
    expect(self.items.store.get("ITEM-DEL-1" as GroceryItemUid)).toBeUndefined();
  });

  it("sync-not-ready blocks delete_grocery_item when stores not loaded", async () => {
    // No seed — grocery stores are cold
    const result = await kh.callTool("delete_grocery_item", { uid: "ITEM-1" });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("delete an already-deleted UID returns already-deleted message", async () => {
    const existingItem = makeGroceryItem({
      uid: "ITEM-DEL-2" as GroceryItemUid,
      ingredient: "Eggs",
    });
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [existingItem],
      aisles: [],
      groceryIngredients: [],
    });
    // Remove the item directly via the store (no API call needed)
    (kh.self() as GrocerySelf).items.store.delete("ITEM-DEL-2" as GroceryItemUid);

    const result = await kh.callTool("delete_grocery_item", {
      uid: "ITEM-DEL-2",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("already deleted");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("delete a UID never in the store returns not-found message", async () => {
    kh.seed({
      groceryLists: [WEEKLY_LIST],
      groceryItems: [],
      aisles: [],
      groceryIngredients: [],
    });

    const result = await kh.callTool("delete_grocery_item", {
      uid: "NEVER-EXISTED",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no grocery item found");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });
});
