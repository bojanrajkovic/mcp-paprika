import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroceryState } from "../module.js";

import { makeAisle } from "../../../../test/domains/aisle/__fixtures__/aisles.js";
import { makeGroceryItem } from "../../../../test/domains/grocery/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../../test/domains/grocery/__fixtures__/grocery-lists.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("list_grocery_lists tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    // DO NOT seed — stores are empty, hasSynced is false
    const text = await kh.callToolText("list_grocery_lists", {});
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns empty message when no lists exist", async () => {
    kh.seed({ groceryLists: [], groceryItems: [] });
    const text = await kh.callToolText("list_grocery_lists", {});
    expect(text).toBe("No grocery lists found.");
  });

  it("returns list names, UIDs, and item counts", async () => {
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Costco Run" });
    const item1 = makeGroceryItem({ listUid: listA.uid });
    const item2 = makeGroceryItem({ listUid: listA.uid });
    const item3 = makeGroceryItem({ listUid: listB.uid });
    kh.seed({ groceryLists: [listA, listB], groceryItems: [item1, item2, item3] });

    const text = await kh.callToolText("list_grocery_lists", {});

    expect(text).toContain("You have 2 grocery list(s)");
    expect(text).toContain("Weekly Shopping");
    expect(text).toContain("Costco Run");
    expect(text).toContain(listA.uid);
    expect(text).toContain(listB.uid);
    expect(text).toContain("2 item(s)");
    expect(text).toContain("1 item(s)");
  });

  it("sorts lists alphabetically by name", async () => {
    const listZ = makeGroceryList({ name: "Zebra Market" });
    const listA = makeGroceryList({ name: "Aldi Trip" });
    const listM = makeGroceryList({ name: "Monthly Stock" });
    kh.seed({ groceryLists: [listZ, listA, listM], groceryItems: [] });

    const text = await kh.callToolText("list_grocery_lists", {});

    const aldiIdx = text.indexOf("Aldi Trip");
    const monthlyIdx = text.indexOf("Monthly Stock");
    const zebraIdx = text.indexOf("Zebra Market");

    expect(aldiIdx).toBeGreaterThan(-1);
    expect(monthlyIdx).toBeGreaterThan(-1);
    expect(zebraIdx).toBeGreaterThan(-1);
    expect(aldiIdx).toBeLessThan(monthlyIdx);
    expect(monthlyIdx).toBeLessThan(zebraIdx);
  });
});

describe("read_grocery_list tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    const text = await kh.callToolText("read_grocery_list", { lookup: { uid: "some-uid" } });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns not-found when UID does not match any list", async () => {
    kh.seed({ groceryLists: [], groceryItems: [] });
    const text = await kh.callToolText("read_grocery_list", { lookup: { uid: "nonexistent-uid" } });
    expect(text.toLowerCase()).toContain("no grocery list found");
  });

  it("returns list metadata and items when fetched by UID", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item1 = makeGroceryItem({ listUid: list.uid, ingredient: "Apples" });
    const item2 = makeGroceryItem({ listUid: list.uid, ingredient: "Milk" });
    kh.seed({ groceryLists: [list], groceryItems: [item1, item2] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { uid: list.uid } });

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
    expect(text).toContain("Apples");
    expect(text).toContain("Milk");
  });

  it("includes each item's UID so the per-item tools can be driven", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item1 = makeGroceryItem({ listUid: list.uid, ingredient: "Apples" });
    const item2 = makeGroceryItem({ listUid: list.uid, ingredient: "Milk" });
    kh.seed({ groceryLists: [list], groceryItems: [item1, item2] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { uid: list.uid } });

    expect(text).toContain("| UID |");
    expect(text).toContain(`\`${item1.uid}\``);
    expect(text).toContain(`\`${item2.uid}\``);
  });

  it("renders aisle names from the live catalog, not the item's denormalized copy", async () => {
    // The item carries the stale pre-rename name; the catalog has the renamed
    // aisle. Render must show the catalog name (render-resolve over cascade).
    const aisle = makeAisle({ name: "Fresh Produce" });
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item = makeGroceryItem({ listUid: list.uid, ingredient: "Apples", aisle: "Produce", aisleUid: aisle.uid });
    kh.seed({ groceryLists: [list], groceryItems: [item], aisles: [aisle] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { uid: list.uid } });

    expect(text).toContain("Fresh Produce");
    expect(text).not.toContain("| Produce |");
  });

  it("falls back to the denormalized aisle name for a dangling aisle UID", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item = makeGroceryItem({ listUid: list.uid, ingredient: "Apples", aisle: "Produce", aisleUid: "gone-uid" });
    kh.seed({ groceryLists: [list], groceryItems: [item], aisles: [] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { uid: list.uid } });

    expect(text).toContain("Produce");
  });

  it("resolves by exact name match", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { name: "Weekly Shopping" } });

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("resolves by starts-with name match", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { name: "Weekly" } });

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("resolves by contains name match", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { name: "Shopping" } });

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
  });

  it("returns not-found when name does not match any list", async () => {
    kh.seed({ groceryLists: [makeGroceryList({ name: "Weekly Shopping" })], groceryItems: [] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { name: "Completely Different" } });

    expect(text.toLowerCase()).toContain("no grocery lists found matching");
  });

  it("returns disambiguation when multiple lists match the same tier", async () => {
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Weekly Costco" });
    kh.seed({ groceryLists: [listA, listB], groceryItems: [] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { name: "Weekly" } });

    expect(text).toContain("Multiple grocery lists match");
    expect(text).toContain(listA.uid);
    expect(text).toContain(listB.uid);
    expect(text).toContain("Please re-invoke with a specific uid");
  });
});

describe("create_grocery_list tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    const text = await kh.callToolText("create_grocery_list", { name: "Weekly Shopping" });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("creates list with uppercase UUID and correct defaults", async () => {
    vi.mocked(kh.client().saveGroceryList).mockImplementation((list) => okAsync(list));
    kh.seed({ groceryLists: [], groceryItems: [] });

    const text = await kh.callToolText("create_grocery_list", { name: "Weekly Shopping" });

    expect(text).toContain("Weekly Shopping");
    expect(kh.client().saveGroceryList).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(kh.client().saveGroceryList).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs["name"]).toBe("Weekly Shopping");
    expect(callArgs["isDefault"]).toBe(false);
    expect(callArgs["orderFlag"]).toBe(0);
    expect(callArgs["remindersList"]).toBe("Paprika");
    expect(callArgs["deleted"]).toBe(false);
    expect(typeof callArgs["uid"]).toBe("string");
    expect(callArgs["uid"] as string).toMatch(/^[0-9A-F-]{36}$/);
    expect(kh.resourceListChanged()).toHaveBeenCalledOnce();
  });

  it("store contains the new list after creation", async () => {
    vi.mocked(kh.client().saveGroceryList).mockImplementation((list) => okAsync(list));
    kh.seed({ groceryLists: [], groceryItems: [] });

    await kh.callTool("create_grocery_list", { name: "Weekly Shopping" });

    const all = kh.state().lists.store.getAll();
    expect(all).toHaveLength(1);
    expect(all[0]!.name).toBe("Weekly Shopping");
  });

  it("rejects duplicate name (exact case-insensitive match)", async () => {
    const existing = makeGroceryList({ name: "Weekly Shopping" });
    kh.seed({ groceryLists: [existing], groceryItems: [] });

    const text = await kh.callToolText("create_grocery_list", { name: "weekly shopping" });

    expect(text).toContain("already exists");
    expect(text).toContain(existing.uid);
    expect(kh.client().saveGroceryList).not.toHaveBeenCalled();
  });

  it("allows creation when name matches only by starts-with (not exact)", async () => {
    vi.mocked(kh.client().saveGroceryList).mockImplementation((list) => okAsync(list));
    const existing = makeGroceryList({ name: "Weekly Shopping Costco" });
    kh.seed({ groceryLists: [existing], groceryItems: [] });

    // "Weekly Shopping" is a prefix of "Weekly Shopping Costco" but not an exact match
    const text = await kh.callToolText("create_grocery_list", { name: "Weekly Shopping" });

    expect(kh.client().saveGroceryList).toHaveBeenCalledOnce();
    expect(text).toContain("Weekly Shopping");
  });
});

describe("rename_grocery_list tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    const text = await kh.callToolText("rename_grocery_list", { uid: "some-uid", newName: "New Name" });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns not-found when UID does not match any list", async () => {
    kh.seed({ groceryLists: [], groceryItems: [] });
    const text = await kh.callToolText("rename_grocery_list", { uid: "nonexistent-uid", newName: "New Name" });
    expect(text.toLowerCase()).toContain("no grocery list found");
  });

  it("renames list and calls save", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    vi.mocked(kh.client().saveGroceryList).mockImplementation((l) => okAsync(l));
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const text = await kh.callToolText("rename_grocery_list", { uid: list.uid, newName: "Costco Run" });

    expect(text).toContain("Costco Run");
    expect(kh.client().saveGroceryList).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(kh.client().saveGroceryList).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs["name"]).toBe("Costco Run");
    expect(callArgs["uid"]).toBe(list.uid);
    expect(kh.resourceListChanged()).toHaveBeenCalledOnce();
  });

  it("same name (exact case) is a no-op, does not call save", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const text = await kh.callToolText("rename_grocery_list", { uid: list.uid, newName: "Weekly Shopping" });

    expect(text).toContain("Weekly Shopping");
    expect(text).toContain(list.uid);
    expect(kh.client().saveGroceryList).not.toHaveBeenCalled();
  });

  it("same name (different case) is a no-op, does not call save", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const text = await kh.callToolText("rename_grocery_list", { uid: list.uid, newName: "weekly shopping" });

    expect(kh.client().saveGroceryList).not.toHaveBeenCalled();
    expect(text).toContain("Weekly Shopping");
  });

  it("rejects rename when newName conflicts with another list", async () => {
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Costco Run" });
    kh.seed({ groceryLists: [listA, listB], groceryItems: [] });

    const text = await kh.callToolText("rename_grocery_list", { uid: listA.uid, newName: "Costco Run" });

    expect(text).toContain("already exists");
    expect(text).toContain(listB.uid);
    expect(kh.client().saveGroceryList).not.toHaveBeenCalled();
  });
});

describe("delete_grocery_list tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sync-not-ready message when stores not loaded", async () => {
    const text = await kh.callToolText("delete_grocery_list", { uid: "some-uid" });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns not-found for unknown UID", async () => {
    kh.seed({ groceryLists: [], groceryItems: [] });

    const text = await kh.callToolText("delete_grocery_list", { uid: "nonexistent-uid" });

    expect(text.toLowerCase()).toContain("no grocery list found");
    expect(kh.client().saveGroceryList).not.toHaveBeenCalled();
  });

  it("soft-deletes list by setting deleted: true", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    vi.mocked(kh.client().saveGroceryList).mockImplementation((l) => okAsync(l));
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const text = await kh.callToolText("delete_grocery_list", { uid: list.uid });

    expect(text).toContain("deleted");
    expect(kh.client().saveGroceryList).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(kh.client().saveGroceryList).mock.calls[0]?.[0] as Record<string, unknown>;
    expect(callArgs["deleted"]).toBe(true);
    expect(callArgs["uid"]).toBe(list.uid);
    expect(kh.resourceListChanged()).toHaveBeenCalledOnce();
  });

  it("already-deleted UID returns idempotent message", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    vi.mocked(kh.client().saveGroceryList).mockImplementation((l) => okAsync(l));
    kh.seed({ groceryLists: [list], groceryItems: [] });

    // First delete — removes the list from the store
    await kh.callTool("delete_grocery_list", { uid: list.uid });
    vi.mocked(kh.client().saveGroceryList).mockClear();

    // Second delete — should return idempotent message, NOT call save again
    const text = await kh.callToolText("delete_grocery_list", { uid: list.uid });

    expect(text.toLowerCase()).toContain("already deleted");
    expect(kh.client().saveGroceryList).not.toHaveBeenCalled();
  });

  it("does not cascade to items (no saveGroceryItems call)", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item = makeGroceryItem({ listUid: list.uid });
    vi.mocked(kh.client().saveGroceryList).mockImplementation((l) => okAsync(l));
    kh.seed({ groceryLists: [list], groceryItems: [item] });

    await kh.callTool("delete_grocery_list", { uid: list.uid });

    // Only saveGroceryList should be called — no saveGroceryItems
    expect(kh.client().saveGroceryList).toHaveBeenCalledOnce();
    // The auto-stubbing mock client would record any saveGroceryItems call if it happened
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });
});
