import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PantryItemUid } from "../ids.js";
import type { PantryState } from "../module.js";

import { makePantryItem } from "../../../../test/domains/pantry/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

describe("clear_out_of_stock_pantry_items tool", () => {
  const kh = useKernelHarness<PantryState>("pantry");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("clears only out-of-stock items, leaving in-stock items intact", async () => {
    const oos1 = makePantryItem({ uid: "P-OOS-1" as PantryItemUid, ingredient: "Milk", inStock: false });
    const oos2 = makePantryItem({ uid: "P-OOS-2" as PantryItemUid, ingredient: "Eggs", inStock: false });
    const inStock = makePantryItem({ uid: "P-IN-1" as PantryItemUid, ingredient: "Butter", inStock: true });
    kh.seed({ pantry: [oos1, oos2, inStock] });
    vi.mocked(kh.client().savePantryItems).mockImplementation((items) => okAsync(items));

    const result = await kh.callTool("clear_out_of_stock_pantry_items", {});
    const text = getText(result);

    expect(text).toContain("2");
    expect(text.toLowerCase()).toContain("cleared");
    expect(kh.client().savePantryItems).toHaveBeenCalledOnce();

    const savedItems = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] as ReadonlyArray<{
      uid: string;
      deleted: boolean;
    }>;
    expect(savedItems).toHaveLength(2);
    const savedUids = savedItems.map((i) => i.uid).sort();
    expect(savedUids).toEqual(["P-OOS-1", "P-OOS-2"].sort());
    for (const item of savedItems) {
      expect(item.deleted).toBe(true);
    }

    // OOS items removed; in-stock item remains
    const state = kh.state();
    expect(state.store.get("P-OOS-1" as PantryItemUid)).toBeUndefined();
    expect(state.store.get("P-OOS-2" as PantryItemUid)).toBeUndefined();
    expect(state.store.get("P-IN-1" as PantryItemUid)).toBeDefined();
  });

  it("declining the confirm cancels without writing", async () => {
    const oos = makePantryItem({ uid: "P-OOS-1" as PantryItemUid, ingredient: "Milk", inStock: false });
    kh.seed({ pantry: [oos] });
    kh.setElicitResponder(() => ({ action: "decline" }));

    const result = await kh.callTool("clear_out_of_stock_pantry_items", {});
    const text = getText(result);

    expect(result.isError).toBeFalsy();
    expect(text).toContain("Cancelled");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("returns informational message when no out-of-stock items, savePantryItems NOT called", async () => {
    const inStock = makePantryItem({ uid: "P-IN-1" as PantryItemUid, ingredient: "Butter", inStock: true });
    kh.seed({ pantry: [inStock] });

    const result = await kh.callTool("clear_out_of_stock_pantry_items", {});
    const text = getText(result);

    expect(text.toLowerCase()).toContain("no out-of-stock items to clear");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("returns sync message when pantry not loaded", async () => {
    const result = await kh.callTool("clear_out_of_stock_pantry_items", {});
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("returns isError when savePantryItems errs", async () => {
    const oos = makePantryItem({ uid: "P-OOS-1" as PantryItemUid, ingredient: "Milk", inStock: false });
    kh.seed({ pantry: [oos] });
    vi.mocked(kh.client().savePantryItems).mockReturnValue(errAsync(new Error("Network error")));

    const result = await kh.callTool("clear_out_of_stock_pantry_items", {});

    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Failed to clear out-of-stock pantry items");
  });
});
