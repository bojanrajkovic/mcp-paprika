import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PantryItemUid } from "../../../ids.js";
import type { PantryState } from "../module.js";

import { makePantryItem } from "../../../../test/domains/pantry/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("delete_pantry_item tool", () => {
  const kh = useKernelHarness<PantryState>("pantry");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("happy path — sets deleted=true, saves, and reports success", async () => {
    const item = makePantryItem({ uid: "uid-1" as PantryItemUid, ingredient: "Butter", deleted: false });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);
    kh.seed({ pantry: [item] });

    const text = await kh.callToolText("delete_pantry_item", { uid: "uid-1" });

    expect(text).toContain('Pantry item "Butter" has been deleted.');
    expect(kh.client().savePantryItems).toHaveBeenCalledOnce();

    const [callArgs] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(callArgs?.deleted).toBe(true);
    expect(callArgs?.ingredient).toBe("Butter");

    // Item is removed from the store after a successful commit.
    const after = kh.state().store.get("uid-1" as PantryItemUid);
    expect(after).toBeUndefined();
  });

  it("unknown UID returns no-item-found, store not mutated", async () => {
    kh.seed({ pantry: [] });

    const text = await kh.callToolText("delete_pantry_item", { uid: "missing" });

    expect(text).toContain("No pantry item found");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
    expect(kh.state().store.size).toBe(0);
  });

  it("cold-start guard blocks call before pantry synced", async () => {
    // store never seeded → hasSynced === false
    const text = await kh.callToolText("delete_pantry_item", { uid: "uid-1" });

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("savePantryItems API error returns error message, store not mutated", async () => {
    const item = makePantryItem({ uid: "uid-1" as PantryItemUid, ingredient: "Butter", deleted: false });
    vi.mocked(kh.client().savePantryItems).mockRejectedValue(new Error("server timeout"));
    kh.seed({ pantry: [item] });

    const text = await kh.callToolText("delete_pantry_item", { uid: "uid-1" });

    expect(text).toContain("Failed to delete pantry item");
    expect(text).toContain("server timeout");

    // Store still has the original non-deleted item.
    const after = kh.state().store.get("uid-1" as PantryItemUid);
    expect(after).toBeDefined();
    expect(after?.deleted).toBe(false);
  });

  it("retry path after successful delete returns the widened 'already deleted' miss message", async () => {
    // After a successful delete the item is gone from the store; a retried call
    // returns the widened miss message (which names "already deleted") instead
    // of failing.
    kh.seed({
      pantry: [makePantryItem({ uid: "uid-retry" as PantryItemUid, ingredient: "Butter", deleted: false })],
    });
    // Simulate the post-commit state: delete() removes the item from the store.
    kh.state().store.delete("uid-retry" as PantryItemUid);

    const text = await kh.callToolText("delete_pantry_item", { uid: "uid-retry" });

    expect(text).toContain("already deleted");
    expect(text).toContain("uid-retry");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });
});
