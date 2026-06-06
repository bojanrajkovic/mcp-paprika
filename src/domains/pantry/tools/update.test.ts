import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PantryItemUid } from "../ids.js";
import type { PantryState } from "../module.js";

import { makeAisle } from "../../../../test/domains/aisle/__fixtures__/aisles.js";
import { makePantryItem } from "../../../../test/domains/pantry/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { updatePantryItemInputSchema } from "./update.js";

describe("update_pantry_item tool", () => {
  const kh = useKernelHarness<PantryState>("pantry");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("partial merge — only provided fields change", async () => {
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      ingredient: "Butter",
      quantity: "1 lb",
      aisle: "Dairy",
      inStock: true,
      notes: "salted",
    });
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) => okAsync(items));
    kh.seed({ pantry: [item] });

    const result = await kh.callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2 lb",
    });
    const text = getText(result);

    expect(text).toContain("Butter");
    expect(kh.client().savePantryItems).toHaveBeenCalledOnce();

    const [callArgs] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(callArgs).toBeDefined();
    expect(callArgs?.quantity).toBe("2 lb");
    expect(callArgs?.ingredient).toBe("Butter");
    expect(callArgs?.aisle).toBe("Dairy");
    expect(callArgs?.inStock).toBe(true);
    expect(callArgs?.notes).toBe("salted");
    expect(callArgs?.uid).toBe("uid-1");
  });

  it("inStock is rejected — promoted to mark_pantry_item_out_of_stock / restock_pantry_item", () => {
    // The stock transition left update_pantry_item for its own intent verbs. The
    // strict schema rejects a stray `inStock` key (the SDK surfaces it as an
    // isError) rather than silently dropping it.
    expect(updatePantryItemInputSchema.safeParse({ uid: "uid-1", inStock: false }).success).toBe(false);
  });

  it("expirationDate provided as string derives hasExpiration=true", async () => {
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      expirationDate: null,
      hasExpiration: false,
    });
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) => okAsync(items));
    kh.seed({ pantry: [item] });

    await kh.callTool("update_pantry_item", {
      uid: "uid-1",
      expirationDate: "2026-12-31",
    });

    const [callArgs] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    // User input is normalized to Paprika wire format ("yyyy-MM-dd HH:mm:ss" at midnight).
    expect(callArgs?.expirationDate).toBe("2026-12-31 00:00:00");
    expect(callArgs?.hasExpiration).toBe(true);
  });

  it("expirationDate provided as null derives hasExpiration=false", async () => {
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      expirationDate: "2026-12-31",
      hasExpiration: true,
    });
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) => okAsync(items));
    kh.seed({ pantry: [item] });

    await kh.callTool("update_pantry_item", {
      uid: "uid-1",
      expirationDate: null,
    });

    const [callArgs] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(callArgs?.expirationDate).toBe(null);
    expect(callArgs?.hasExpiration).toBe(false);
  });

  it("expirationDate omitted leaves both unchanged", async () => {
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      expirationDate: "2026-12-31",
      hasExpiration: true,
    });
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) => okAsync(items));
    kh.seed({ pantry: [item] });

    await kh.callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2 lb",
    });

    const [callArgs] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(callArgs?.expirationDate).toBe("2026-12-31");
    expect(callArgs?.hasExpiration).toBe(true);
  });

  it("unknown UID returns no-item-found, store not mutated", async () => {
    kh.seed({ pantry: [] });

    const result = await kh.callTool("update_pantry_item", {
      uid: "missing",
      quantity: "2",
    });
    const text = getText(result);

    expect(text).toContain("No pantry item found");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
    expect(kh.state().store.size).toBe(0);
  });

  it("cold-start guard blocks call before pantry synced", async () => {
    // store never seeded → hasSynced === false
    const result = await kh.callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2",
    });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("known aisle sets both aisle and aisleUid", async () => {
    const dairyAisle = makeAisle({ name: "Dairy" });
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      aisle: "Old Aisle",
      aisleUid: "old-uid",
    });
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) => okAsync(items));
    kh.seed({ pantry: [item], aisles: [dairyAisle] });

    await kh.callTool("update_pantry_item", { uid: "uid-1", aisle: "Dairy" });

    const [callArgs] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(callArgs?.aisle).toBe("Dairy");
    expect(callArgs?.aisleUid).toBe(dairyAisle.uid);
  });

  it("omitting aisle preserves both aisle and aisleUid", async () => {
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      aisle: "Frozen",
      aisleUid: "frozen-uid",
    });
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) => okAsync(items));
    kh.seed({ pantry: [item], aisles: [] });

    await kh.callTool("update_pantry_item", { uid: "uid-1", quantity: "3 lbs" });

    const [callArgs] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(callArgs?.aisle).toBe("Frozen");
    expect(callArgs?.aisleUid).toBe("frozen-uid");
  });

  it("unknown aisle is created and both fields set", async () => {
    const item = makePantryItem({ uid: "uid-1" as PantryItemUid });
    const newAisle = makeAisle({ name: "International" });
    vi.mocked(kh.client().saveAisle).mockReturnValue(okAsync(newAisle));
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) => okAsync(items));
    kh.seed({ pantry: [item], aisles: [] });

    await kh.callTool("update_pantry_item", { uid: "uid-1", aisle: "International" });

    expect(kh.client().saveAisle).toHaveBeenCalledOnce();
    const [callArgs] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(callArgs?.aisle).toBe(newAisle.name);
    expect(callArgs?.aisleUid).toBe(newAisle.uid);
  });

  it("savePantryItems API error returns error message, store not mutated", async () => {
    const item = makePantryItem({
      uid: "uid-1" as PantryItemUid,
      quantity: "1 lb",
    });
    vi.mocked(kh.client().savePantryItems).mockReturnValue(errAsync(new Error("server timeout")));
    kh.seed({ pantry: [item] });

    const result = await kh.callTool("update_pantry_item", {
      uid: "uid-1",
      quantity: "2 lb",
    });
    const text = getText(result);

    expect(text).toContain("Failed to update pantry item");
    expect(text).toContain("server timeout");
    // The original item is still in the store.
    const after = kh.state().store.get("uid-1" as PantryItemUid);
    expect(after).toBeDefined();
    expect(after?.quantity).toBe("1 lb");
  });
});
