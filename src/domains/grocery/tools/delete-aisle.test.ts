import { errAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AisleState } from "../../aisle/module.js";
import type { Aisle } from "../../aisle/types.js";
import type { GroceryState } from "../module.js";

import { makeAisle } from "../../../../test/domains/aisle/__fixtures__/aisles.js";
import { makeGroceryItem } from "../../../../test/domains/grocery/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../../test/domains/grocery/__fixtures__/grocery-lists.js";
import { makePantryItem } from "../../../../test/domains/pantry/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("delete_aisle tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  const aisleState = (): AisleState => kh.stateOf("aisle") as AisleState;

  function seedBase(aisle: Aisle): void {
    kh.seed({ groceryLists: [makeGroceryList()], groceryItems: [], aisles: [aisle], pantry: [] });
  }

  it("returns sync-not-ready when grocery has not synced", async () => {
    const text = await kh.callToolText("delete_aisle", { uid: "aisle-x" });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns not-found for an unknown aisle UID", async () => {
    seedBase(makeAisle());
    const text = await kh.callToolText("delete_aisle", { uid: "nope" });
    expect(text).toContain('No aisle found with UID "nope"');
  });

  it("blocks while unpurchased grocery items reference the aisle", async () => {
    const aisle = makeAisle({ name: "Bakery" });
    const list = makeGroceryList();
    const item = makeGroceryItem({ listUid: list.uid, aisleUid: aisle.uid, purchased: false });
    kh.seed({ groceryLists: [list], groceryItems: [item], aisles: [aisle], pantry: [] });

    const text = await kh.callToolText("delete_aisle", { uid: aisle.uid });

    expect(text).toContain('Cannot delete "Bakery"');
    expect(text).toContain("1 unpurchased grocery item");
    expect(kh.client().saveAisles).not.toHaveBeenCalled();
    expect(aisleState().store.get(aisle.uid)).toBeDefined();
  });

  it("blocks while pantry items reference the aisle", async () => {
    const aisle = makeAisle({ name: "Bakery" });
    const pantryItem = makePantryItem({ aisleUid: aisle.uid });
    kh.seed({ groceryLists: [makeGroceryList()], groceryItems: [], aisles: [aisle], pantry: [pantryItem] });

    const text = await kh.callToolText("delete_aisle", { uid: aisle.uid });

    expect(text).toContain('Cannot delete "Bakery"');
    expect(text).toContain("1 pantry item");
    expect(kh.client().saveAisles).not.toHaveBeenCalled();
  });

  it("does not block on purchased grocery items", async () => {
    const aisle = makeAisle({ name: "Bakery" });
    const list = makeGroceryList();
    const bought = makeGroceryItem({ listUid: list.uid, aisleUid: aisle.uid, purchased: true });
    kh.seed({ groceryLists: [list], groceryItems: [bought], aisles: [aisle], pantry: [] });

    const text = await kh.callToolText("delete_aisle", { uid: aisle.uid });

    expect(text).toBe('Deleted aisle "Bakery".');
  });

  it("tombstone-deletes the aisle and removes it from the catalog", async () => {
    const aisle = makeAisle({ name: "Bakery" });
    seedBase(aisle);

    const text = await kh.callToolText("delete_aisle", { uid: aisle.uid });

    expect(text).toBe('Deleted aisle "Bakery".');
    expect(kh.resourceListChanged()).toHaveBeenCalled();
    const saveAisles = vi.mocked(kh.client().saveAisles);
    expect(saveAisles).toHaveBeenCalledOnce();
    const saved = saveAisles.mock.calls[0]![0] as ReadonlyArray<Aisle>;
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ uid: aisle.uid, deleted: true });
    expect(aisleState().store.get(aisle.uid)).toBeUndefined();
  });

  it("surfaces a save failure and keeps the aisle", async () => {
    const aisle = makeAisle({ name: "Bakery" });
    seedBase(aisle);
    vi.mocked(kh.client().saveAisles).mockReturnValue(
      errAsync({ kind: "http", status: 500, message: "boom" } as never),
    );

    const text = await kh.callToolText("delete_aisle", { uid: aisle.uid });

    expect(text).toContain('Failed to delete aisle "Bakery"');
    expect(aisleState().store.get(aisle.uid)).toBeDefined();
  });
});
