import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PantryItemUid } from "../ids.js";
import type { PantryState } from "../module.js";

import { makePantryItem } from "../../../../test/domains/pantry/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("list_pantry_items tool", () => {
  const kh = useKernelHarness<PantryState>("pantry");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns sorted listing with ingredient names and UIDs", async () => {
    kh.seed({
      pantry: [
        makePantryItem({ ingredient: "Sugar" }),
        makePantryItem({ ingredient: "Apples" }),
        makePantryItem({ ingredient: "Milk" }),
      ],
    });

    const payload = await kh.callToolJson<{ items: Array<{ uid: string; ingredient: string }> }>(
      "list_pantry_items",
      {},
    );

    expect(payload.items).toHaveLength(3);

    // Alphabetical ordering: Apples before Milk before Sugar.
    const names = payload.items.map((i) => i.ingredient);
    const applesIdx = names.indexOf("Apples");
    const milkIdx = names.indexOf("Milk");
    const sugarIdx = names.indexOf("Sugar");

    expect(applesIdx).toBeGreaterThan(-1);
    expect(milkIdx).toBeGreaterThan(-1);
    expect(sugarIdx).toBeGreaterThan(-1);
    expect(applesIdx).toBeLessThan(milkIdx);
    expect(milkIdx).toBeLessThan(sugarIdx);

    // UIDs are present so the caller can chain follow-up operations.
    const storeItems = kh.state().store.getAll();
    for (const item of storeItems) {
      expect(payload.items.some((i) => i.uid === item.uid)).toBe(true);
    }
  });

  it("returns friendly message for empty pantry", async () => {
    kh.seed({ pantry: [] });

    const payload = await kh.callToolJson<{ items: Array<unknown> }>("list_pantry_items", {});

    // Empty pantry returns {items:[]} as compact JSON, not a prose "pantry is empty" message.
    expect(payload.items).toHaveLength(0);
  });

  it("emits structured rows; absent quantity/aisle normalize to null (R1)", async () => {
    kh.seed({
      pantry: [
        makePantryItem({
          uid: "p-milk" as PantryItemUid,
          ingredient: "Milk",
          quantity: "1 gal",
          aisle: "Dairy",
          inStock: true,
          expirationDate: null,
        }),
        makePantryItem({
          uid: "p-eggs" as PantryItemUid,
          ingredient: "Eggs",
          quantity: "",
          aisle: "",
          inStock: false,
          expirationDate: "2026-12-01",
        }),
      ],
    });
    const result = await kh.callTool("list_pantry_items", {});
    expect(result.isError).toBeFalsy();
    const { items } = result.structuredContent as { items: Array<Record<string, unknown>> };
    // Alphabetical (Eggs before Milk); the "" sentinels become null.
    expect(items).toEqual([
      { uid: "p-eggs", ingredient: "Eggs", quantity: null, aisle: null, inStock: false, expirationDate: "2026-12-01" },
      { uid: "p-milk", ingredient: "Milk", quantity: "1 gal", aisle: "Dairy", inStock: true, expirationDate: null },
    ]);
  });

  it("cold-start (hasSynced false) returns guard error", async () => {
    // Store never seeded — hasSynced remains false.
    const text = await kh.callToolText("list_pantry_items", {});

    expect(text.toLowerCase()).toContain("not yet synced");
  });
});
