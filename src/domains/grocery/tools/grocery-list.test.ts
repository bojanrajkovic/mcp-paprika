import { okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroceryState } from "../module.js";

import { makeAisle } from "../../../../test/domains/aisle/__fixtures__/aisles.js";
import { makeGroceryItem } from "../../../../test/domains/grocery/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../../test/domains/grocery/__fixtures__/grocery-lists.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { NO_AISLE_UID } from "../../aisle/ids.js";

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
    const json = await kh.callToolJson<{ items: unknown[] }>("list_grocery_lists", {});
    expect(json.items).toEqual([]);
  });

  it("returns list names, UIDs, and item counts", async () => {
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Costco Run" });
    const item1 = makeGroceryItem({ listUid: listA.uid });
    const item2 = makeGroceryItem({ listUid: listA.uid });
    const item3 = makeGroceryItem({ listUid: listB.uid });
    kh.seed({ groceryLists: [listA, listB], groceryItems: [item1, item2, item3] });

    const json = await kh.callToolJson<{ items: Array<{ uid: string; name: string; itemCount: number }> }>(
      "list_grocery_lists",
      {},
    );

    expect(json.items).toHaveLength(2);
    const names = json.items.map((i) => i.name);
    expect(names).toContain("Weekly Shopping");
    expect(names).toContain("Costco Run");
    const uids = json.items.map((i) => i.uid);
    expect(uids).toContain(listA.uid);
    expect(uids).toContain(listB.uid);
    const weeklyItem = json.items.find((i) => i.name === "Weekly Shopping")!;
    const costcoItem = json.items.find((i) => i.name === "Costco Run")!;
    expect(weeklyItem.itemCount).toBe(2);
    expect(costcoItem.itemCount).toBe(1);
  });

  it("emits structured grocery-list rows with uid and item count (R1)", async () => {
    const listA = makeGroceryList({ name: "Weekly" });
    const item1 = makeGroceryItem({ listUid: listA.uid });
    kh.seed({ groceryLists: [listA], groceryItems: [item1] });
    const result = await kh.callTool("list_grocery_lists", {});
    expect(result.isError).toBeFalsy();
    const { items } = result.structuredContent as { items: Array<Record<string, unknown>> };
    expect(items).toEqual([{ uid: listA.uid, name: "Weekly", itemCount: 1 }]);
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

    const json = await kh.callToolJson<{ uid: string; name: string; items: Array<{ ingredient: string }> }>(
      "read_grocery_list",
      { lookup: { uid: list.uid } },
    );

    expect(json.name).toBe("Weekly Shopping");
    // The list UID now appears in the text (JSON channel); assert it IS present.
    expect(json.uid).toBe(list.uid);
    const ingredients = json.items.map((i) => i.ingredient);
    expect(ingredients).toContain("Apples");
    expect(ingredients).toContain("Milk");
  });

  it("carries each item's UID on the structured channel; the text table stays clean (B1/#321)", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const item1 = makeGroceryItem({ listUid: list.uid, ingredient: "Apples" });
    const item2 = makeGroceryItem({ listUid: list.uid, ingredient: "Milk" });
    kh.seed({ groceryLists: [list], groceryItems: [item1, item2] });

    const result = await kh.callTool("read_grocery_list", { lookup: { uid: list.uid } });

    // The per-item UID column is retired from the text (the includeItemUids flag, #353).
    expect(getText(result)).not.toContain("| UID |");
    // The item UIDs now ride structuredContent — the C2 grocery-checklist feed.
    const structured = result.structuredContent as {
      uid: string;
      items: ReadonlyArray<{ uid: string; ingredient: string }>;
    };
    expect(structured.uid).toBe(list.uid);
    expect(structured.items).toHaveLength(2);
    const uids = structured.items.map((i) => i.uid);
    expect(uids).toContain(item1.uid);
    expect(uids).toContain(item2.uid);
  });

  it("emits items in store-walk order: aisle orderFlag, then item orderFlag, then uid", async () => {
    // Catalog walk order: Dairy (1) before Produce (2); seeded out of order to prove the sort.
    const dairy = makeAisle({ name: "Dairy", orderFlag: 1 });
    const produce = makeAisle({ name: "Produce", orderFlag: 2 });
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const apples = makeGroceryItem({ listUid: list.uid, ingredient: "Apples", aisleUid: produce.uid, orderFlag: 1 });
    const bananas = makeGroceryItem({ listUid: list.uid, ingredient: "Bananas", aisleUid: produce.uid, orderFlag: 0 });
    const milk = makeGroceryItem({ listUid: list.uid, ingredient: "Milk", aisleUid: dairy.uid, orderFlag: 0 });
    const batteries = makeGroceryItem({
      listUid: list.uid,
      ingredient: "Batteries",
      aisleUid: NO_AISLE_UID,
      aisle: "",
    });
    kh.seed({ groceryLists: [list], groceryItems: [apples, bananas, milk, batteries], aisles: [dairy, produce] });

    const result = await kh.callTool("read_grocery_list", { lookup: { uid: list.uid } });
    const structured = result.structuredContent as { items: ReadonlyArray<{ ingredient: string }> };

    // Dairy before Produce; within Produce item orderFlag 0 (Bananas) before 1 (Apples); no-aisle last.
    expect(structured.items.map((i) => i.ingredient)).toEqual(["Milk", "Bananas", "Apples", "Batteries"]);
  });

  it("keeps same-aisle rows contiguous when two aisles share an orderFlag (tie → by name)", async () => {
    // Bakery and Frozen both at orderFlag 1: the comparator must group each aisle's rows together
    // (the widget groups only consecutive same-aisle rows) and order the tied aisles by name.
    const bakery = makeAisle({ name: "Bakery", orderFlag: 1 });
    const frozen = makeAisle({ name: "Frozen", orderFlag: 1 });
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const bread = makeGroceryItem({ listUid: list.uid, ingredient: "Bread", aisleUid: bakery.uid, orderFlag: 0 });
    const peas = makeGroceryItem({ listUid: list.uid, ingredient: "Peas", aisleUid: frozen.uid, orderFlag: 0 });
    const buns = makeGroceryItem({ listUid: list.uid, ingredient: "Buns", aisleUid: bakery.uid, orderFlag: 1 });
    // Seeded interleaved (Bakery, Frozen, Bakery) to prove the comparator regroups them.
    kh.seed({ groceryLists: [list], groceryItems: [bread, peas, buns], aisles: [bakery, frozen] });

    const result = await kh.callTool("read_grocery_list", { lookup: { uid: list.uid } });
    const structured = result.structuredContent as { items: ReadonlyArray<{ ingredient: string }> };

    // Bakery (name < "Frozen") fully before Frozen; Bakery's rows contiguous by item orderFlag.
    expect(structured.items.map((i) => i.ingredient)).toEqual(["Bread", "Buns", "Peas"]);
  });

  it("groups dangling-aisle rows by their denormalized name so a group isn't split", async () => {
    // Aisles missing from the catalog (app-deleted / sync gap) resolve to the item's denormalized
    // name. The sort must group by that name, not fall through to aisleUid and interleave: here the
    // two "Frozen" rows (uids AISLE-B/AISLE-D) would be split by "Anchovy" (AISLE-C) under a raw
    // aisleUid tie-break.
    const list = makeGroceryList({ name: "Weekly Shopping" });
    const peas = makeGroceryItem({ listUid: list.uid, ingredient: "Peas", aisle: "Frozen", aisleUid: "AISLE-B" });
    const anchovies = makeGroceryItem({
      listUid: list.uid,
      ingredient: "Anchovies",
      aisle: "Anchovy",
      aisleUid: "AISLE-C",
    });
    const spinach = makeGroceryItem({ listUid: list.uid, ingredient: "Spinach", aisle: "Frozen", aisleUid: "AISLE-D" });
    kh.seed({ groceryLists: [list], groceryItems: [peas, anchovies, spinach], aisles: [] });

    const result = await kh.callTool("read_grocery_list", { lookup: { uid: list.uid } });
    const structured = result.structuredContent as { items: ReadonlyArray<{ ingredient: string }> };

    // "Anchovy" (name <  "Frozen") first, then the Frozen pair contiguous.
    expect(structured.items.map((i) => i.ingredient)).toEqual(["Anchovies", "Peas", "Spinach"]);
  });

  it("a not-found read carries no structuredContent (errorResult, B1/#321)", async () => {
    kh.seed({ groceryLists: [], groceryItems: [] });
    const result = await kh.callTool("read_grocery_list", { lookup: { uid: "nope" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
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
  });

  it("resolves by starts-with name match", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { name: "Weekly" } });

    expect(text).toContain("Weekly Shopping");
  });

  it("resolves by contains name match", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const text = await kh.callToolText("read_grocery_list", { lookup: { name: "Shopping" } });

    expect(text).toContain("Weekly Shopping");
  });

  it("returns not-found when name does not match any list", async () => {
    kh.seed({ groceryLists: [makeGroceryList({ name: "Weekly Shopping" })], groceryItems: [] });

    const result = await kh.callTool("read_grocery_list", { lookup: { name: "Completely Different" } });

    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(
      'No grocery lists found matching "Completely Different". Use list_grocery_lists to find it.',
    );
  });

  it("returns disambiguation when multiple lists match the same tier", async () => {
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Weekly Costco" });
    kh.seed({ groceryLists: [listA, listB], groceryItems: [] });

    const result = await kh.callTool("read_grocery_list", { lookup: { name: "Weekly" } });

    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain("Multiple grocery lists match");
    expect(text).toContain(listA.uid);
    expect(text).toContain(listB.uid);
    expect(text).toContain("Re-invoke with a specific uid");
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

  it("carries structuredContent for the new (empty) list (B1/#321)", async () => {
    vi.mocked(kh.client().saveGroceryList).mockImplementation((list) => okAsync(list));
    kh.seed({ groceryLists: [], groceryItems: [] });

    const result = await kh.callTool("create_grocery_list", { name: "Weekly Shopping" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ name: "Weekly Shopping", items: [] });
  });

  it("a duplicate name is an isError with no structuredContent (B1/#321)", async () => {
    const existing = makeGroceryList({ name: "Weekly Shopping" });
    kh.seed({ groceryLists: [existing], groceryItems: [] });

    const result = await kh.callTool("create_grocery_list", { name: "weekly shopping" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
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

    const json = await kh.callToolJson<{ uid: string; name: string }>("rename_grocery_list", {
      uid: list.uid,
      newName: "Weekly Shopping",
    });

    expect(json.name).toBe("Weekly Shopping");
    // The UID now appears in the text (JSON channel); assert it IS present.
    expect(json.uid).toBe(list.uid);
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

  it("carries structuredContent for the renamed list (B1/#321)", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    vi.mocked(kh.client().saveGroceryList).mockImplementation((l) => okAsync(l));
    kh.seed({ groceryLists: [list], groceryItems: [] });

    const result = await kh.callTool("rename_grocery_list", { uid: list.uid, newName: "Costco Run" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ uid: list.uid, name: "Costco Run" });
  });

  it("a conflicting rename is an isError with no structuredContent (B1/#321)", async () => {
    const listA = makeGroceryList({ name: "Weekly Shopping" });
    const listB = makeGroceryList({ name: "Costco Run" });
    kh.seed({ groceryLists: [listA, listB], groceryItems: [] });

    const result = await kh.callTool("rename_grocery_list", { uid: listA.uid, newName: "Costco Run" });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
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

  it("declining the confirm cancels without writing", async () => {
    const list = makeGroceryList({ name: "Weekly Shopping" });
    vi.mocked(kh.client().saveGroceryList).mockImplementation((l) => okAsync(l));
    kh.seed({ groceryLists: [list], groceryItems: [] });

    kh.setElicitResponder(() => ({ action: "decline" }));

    const text = await kh.callToolText("delete_grocery_list", { uid: list.uid });

    expect(text).toContain("Cancelled");
    expect(kh.client().saveGroceryList).not.toHaveBeenCalled();
  });
});
