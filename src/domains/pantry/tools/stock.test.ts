import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PantryItemUid } from "../ids.js";
import type { PantryState } from "../module.js";

import { makePantryItem } from "../../../../test/domains/pantry/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { markPantryItemOutOfStockInputSchema, restockPantryItemInputSchema } from "./stock.js";

describe("mark_pantry_item_out_of_stock tool", () => {
  const kh = useKernelHarness<PantryState>("pantry");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("marks an in-stock item as out of stock", async () => {
    const item = makePantryItem({ uid: "uid-1" as PantryItemUid, ingredient: "Milk", inStock: true });
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) =>
      okAsync(items.map((i) => ({ ...i, inStock: false }))),
    );
    kh.seed({ pantry: [item] });

    const text = await kh.callToolText("mark_pantry_item_out_of_stock", { uid: "uid-1" });

    expect(text).toContain("Milk");
    expect(text).toContain("**In stock:** No");
    expect(kh.client().savePantryItems).toHaveBeenCalledWith([expect.objectContaining({ inStock: false })]);
  });

  it("unknown UID returns no-item-found message, client not called", async () => {
    kh.seed({ pantry: [] });

    const text = await kh.callToolText("mark_pantry_item_out_of_stock", { uid: "missing" });

    expect(text).toContain('No pantry item found with UID "missing" (it may not exist or was already deleted).');
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("schema hard-reject: inStock field rejected on markPantryItemOutOfStockInputSchema", () => {
    expect(markPantryItemOutOfStockInputSchema.safeParse({ uid: "X", inStock: false }).success).toBe(false);
  });

  it("save error returns error message, store not mutated", async () => {
    const item = makePantryItem({ uid: "uid-1" as PantryItemUid, ingredient: "Eggs", inStock: true });
    vi.mocked(kh.client().savePantryItems).mockReturnValue(errAsync(new Error("server timeout")));
    kh.seed({ pantry: [item] });

    const text = await kh.callToolText("mark_pantry_item_out_of_stock", { uid: "uid-1" });

    expect(text).toContain("Failed to update pantry item");
    expect(text).toContain("server timeout");
    // Store retains original in-stock state.
    const after = kh.state().store.get("uid-1" as PantryItemUid);
    expect(after?.inStock).toBe(true);
  });

  it("cold-start guard blocks call before pantry synced", async () => {
    // store never seeded → hasSynced === false
    const text = await kh.callToolText("mark_pantry_item_out_of_stock", { uid: "uid-1" });

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });
});

describe("restock_pantry_item tool", () => {
  const kh = useKernelHarness<PantryState>("pantry");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("marks an out-of-stock item as in stock", async () => {
    const item = makePantryItem({ uid: "uid-2" as PantryItemUid, ingredient: "Butter", inStock: false });
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) =>
      okAsync(items.map((i) => ({ ...i, inStock: true }))),
    );
    kh.seed({ pantry: [item] });

    const text = await kh.callToolText("restock_pantry_item", { uid: "uid-2" });

    expect(text).toContain("Butter");
    expect(text).toContain("**In stock:** Yes");
    expect(kh.client().savePantryItems).toHaveBeenCalledWith([expect.objectContaining({ inStock: true })]);
  });

  it("unknown UID returns no-item-found message, client not called", async () => {
    kh.seed({ pantry: [] });

    const text = await kh.callToolText("restock_pantry_item", { uid: "missing" });

    expect(text).toContain('No pantry item found with UID "missing" (it may not exist or was already deleted).');
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("schema hard-reject: inStock field rejected on restockPantryItemInputSchema", () => {
    expect(restockPantryItemInputSchema.safeParse({ uid: "X", inStock: true }).success).toBe(false);
  });

  it("save error returns error message, store not mutated", async () => {
    const item = makePantryItem({ uid: "uid-2" as PantryItemUid, ingredient: "Cheese", inStock: false });
    vi.mocked(kh.client().savePantryItems).mockReturnValue(errAsync(new Error("server timeout")));
    kh.seed({ pantry: [item] });

    const text = await kh.callToolText("restock_pantry_item", { uid: "uid-2" });

    expect(text).toContain("Failed to update pantry item");
    expect(text).toContain("server timeout");
    // Store retains original out-of-stock state.
    const after = kh.state().store.get("uid-2" as PantryItemUid);
    expect(after?.inStock).toBe(false);
  });

  it("cold-start guard blocks call before pantry synced", async () => {
    // store never seeded → hasSynced === false
    const text = await kh.callToolText("restock_pantry_item", { uid: "uid-2" });

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });
});
