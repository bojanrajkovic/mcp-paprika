import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AisleSelf } from "../../aisle/module.js";
import type { PantrySelf } from "../module.js";

import { makeAisle } from "../../../../test/cache/__fixtures__/aisles.js";
import { makePantryItem } from "../../../../test/cache/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { type AisleUid, type PantryItemUid } from "../../../ids.js";

describe("add_pantry_items tool", () => {
  const kh = useKernelHarness("pantry");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("single item with defaults creates pantry item with correct field values", async () => {
    kh.seed({ pantry: [], aisles: [] });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);

    const result = await kh.callTool("add_pantry_items", { items: [{ ingredient: "Butter" }] });
    const text = getText(result);

    expect(text).toContain("# Butter");
    expect(kh.client().savePantryItems).toHaveBeenCalledOnce();

    const [savedItem] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(savedItem?.ingredient).toBe("Butter");
    expect(savedItem?.quantity).toBe("");
    expect(savedItem?.aisle).toBe("");
    expect(savedItem?.aisleUid).toBe("");
    expect(savedItem?.inStock).toBe(true);
    expect(savedItem?.notes).toBe(null);
    expect(savedItem?.expirationDate).toBe(null);
    expect(savedItem?.hasExpiration).toBe(false);
    expect(savedItem?.deleted).toBe(false);

    const uuidRegex = /^[0-9A-F]{8}-[0-9A-F]{4}-[1-5][0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/;
    expect(savedItem?.uid).toMatch(uuidRegex);

    const paprikaDateRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
    expect(savedItem?.purchaseDate).toMatch(paprikaDateRegex);

    // The item is committed to the store.
    expect((kh.self() as PantrySelf).store.get(savedItem?.uid as PantryItemUid)).toBeDefined();
  });

  it("batch of 3 distinct items calls savePantryItems once with all 3", async () => {
    kh.seed({ pantry: [], aisles: [] });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);

    const result = await kh.callTool("add_pantry_items", {
      items: [{ ingredient: "Apples" }, { ingredient: "Milk" }, { ingredient: "Eggs" }],
    });
    const text = getText(result);

    expect(kh.client().savePantryItems).toHaveBeenCalledOnce();
    const savedItems: ReadonlyArray<{ ingredient: string }> =
      vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(savedItems).toHaveLength(3);
    expect(savedItems.map((i) => i.ingredient)).toEqual(["Apples", "Milk", "Eggs"]);
    expect(text).toContain("Added 3 item(s)");
    expect(kh.client().notifySync).toHaveBeenCalled();
  });

  it("aisle dedup — repeated aisle name calls ensureAisle only once", async () => {
    const existingAisle = makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" });
    kh.seed({ pantry: [], aisles: [existingAisle] });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);

    await kh.callTool("add_pantry_items", {
      items: [
        { ingredient: "Apples", aisle: "Produce" },
        { ingredient: "Oranges", aisle: "Produce" },
        { ingredient: "Bananas", aisle: "produce" }, // different case — same aisle
      ],
    });

    const savedItems: ReadonlyArray<{ aisle: string; aisleUid: string }> =
      vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    for (const item of savedItems) {
      expect(item.aisle).toBe("Produce");
      expect(item.aisleUid).toBe("AISLE-1");
    }
    // saveAisle not called because aisle already exists
    expect(kh.client().saveAisle).not.toHaveBeenCalled();
  });

  it("existing-pantry duplicate skipped with UID and merge suggestion", async () => {
    const existingItem = makePantryItem({ ingredient: "Butter", uid: "EXISTING-UID" as PantryItemUid });
    kh.seed({ pantry: [existingItem], aisles: [] });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);

    const result = await kh.callTool("add_pantry_items", {
      items: [{ ingredient: "Eggs" }, { ingredient: "BUTTER" }], // BUTTER dupes existing
    });
    const text = getText(result);

    expect(text).toContain("Added 1 item(s)");
    expect(text).toContain("EXISTING-UID");
    expect(text).toContain("update_pantry_item");
    const savedItems: ReadonlyArray<{ ingredient: string }> =
      vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(savedItems).toHaveLength(1);
    expect(savedItems[0]?.ingredient).toBe("Eggs");
  });

  it("intra-batch duplicate — second occurrence skipped", async () => {
    kh.seed({ pantry: [], aisles: [] });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);

    const result = await kh.callTool("add_pantry_items", {
      items: [{ ingredient: "Milk" }, { ingredient: "MILK" }],
    });
    const text = getText(result);

    expect(text).toContain("Added 1 item(s)");
    expect(text).toContain("MILK"); // skip report mentions the duplicate
    const savedItems: ReadonlyArray<unknown> = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(savedItems).toHaveLength(1);
  });

  it("all duplicates short-circuits without API calls", async () => {
    kh.seed({
      pantry: [makePantryItem({ ingredient: "Butter", uid: "UID-1" as PantryItemUid })],
      aisles: [],
    });

    const result = await kh.callTool("add_pantry_items", { items: [{ ingredient: "butter" }] });
    const text = getText(result);

    expect(text).toContain("All items were duplicates");
    expect(text).toContain("UID-1");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("unparseable expirationDate rejects entire batch with item index", async () => {
    kh.seed({ pantry: [], aisles: [] });

    const result = await kh.callTool("add_pantry_items", {
      items: [{ ingredient: "Apples" }, { ingredient: "Milk", expirationDate: "not-a-date" }],
    });
    const text = getText(result);

    expect(text).toContain('Item 1 ("Milk")');
    expect(text).toContain("expirationDate");
    expect(text).toContain("not-a-date");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("unparseable purchaseDate rejects entire batch with item index", async () => {
    kh.seed({ pantry: [], aisles: [] });

    const result = await kh.callTool("add_pantry_items", {
      items: [{ ingredient: "Eggs", purchaseDate: "bad-date" }],
    });
    const text = getText(result);

    expect(text).toContain('Item 0 ("Eggs")');
    expect(text).toContain("purchaseDate");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("valid dates normalized to Paprika wire format per item", async () => {
    kh.seed({ pantry: [], aisles: [] });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);

    await kh.callTool("add_pantry_items", {
      items: [
        {
          ingredient: "Yogurt",
          expirationDate: "2026-12-31",
          purchaseDate: "2026-06-01",
        },
      ],
    });

    const [savedItem] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(savedItem?.expirationDate).toBe("2026-12-31 00:00:00");
    expect(savedItem?.purchaseDate).toBe("2026-06-01 00:00:00");
    expect(savedItem?.hasExpiration).toBe(true);
  });

  it("cold-start guard blocks call before pantry synced", async () => {
    // pantry not seeded → hasSynced === false
    const result = await kh.callTool("add_pantry_items", { items: [{ ingredient: "Butter" }] });
    const text = getText(result);

    expect(text.toLowerCase()).toContain("not yet synced");
    expect(kh.client().savePantryItems).not.toHaveBeenCalled();
  });

  it("savePantryItems API error returns error message, store not mutated", async () => {
    kh.seed({ pantry: [], aisles: [] });
    const { PaprikaAPIError } = await import("../../../paprika/errors.js");
    vi.mocked(kh.client().savePantryItems).mockRejectedValue(
      new PaprikaAPIError("Server error", 500, "https://example/api"),
    );

    const result = await kh.callTool("add_pantry_items", { items: [{ ingredient: "Butter" }] });
    const text = getText(result);

    expect(text).toContain("Failed to add pantry items");
    expect(text).toContain("Server error");
    expect((kh.self() as PantrySelf).store.size).toBe(0);
  });

  it("optional fields flow through correctly", async () => {
    const existingAisle = makeAisle({ uid: "AISLE-1" as AisleUid, name: "Produce" });
    kh.seed({ pantry: [], aisles: [existingAisle] });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);

    await kh.callTool("add_pantry_items", {
      items: [
        {
          ingredient: "Apples",
          quantity: "6",
          aisle: "Produce",
          inStock: false,
        },
      ],
    });

    const [savedItem] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(savedItem?.ingredient).toBe("Apples");
    expect(savedItem?.quantity).toBe("6");
    expect(savedItem?.aisle).toBe("Produce");
    expect(savedItem?.aisleUid).toBe("AISLE-1");
    expect(savedItem?.inStock).toBe(false);
    expect(savedItem?.notes).toBe(null);
  });

  it("mixed duplicates and valid items — correct split in response", async () => {
    kh.seed({
      pantry: [makePantryItem({ ingredient: "Butter", uid: "UID-BT" as PantryItemUid })],
      aisles: [],
    });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);

    const result = await kh.callTool("add_pantry_items", {
      items: [
        { ingredient: "Eggs" },
        { ingredient: "butter" }, // dupe
        { ingredient: "Milk" },
      ],
    });
    const text = getText(result);

    expect(text).toContain("Added 2 item(s)");
    expect(text).toContain("UID-BT");
    expect(text).toContain("Skipped");
    const savedItems: ReadonlyArray<{ ingredient: string }> =
      vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(savedItems).toHaveLength(2);
    expect(savedItems.map((i) => i.ingredient)).toEqual(["Eggs", "Milk"]);
  });

  it("unknown aisle auto-created and UID threaded through", async () => {
    const newAisle = makeAisle({ name: "Exotic", uid: "AISLE-EX" as AisleUid });
    // aisle store seeded as empty + synced so ensureAisle knows it can create
    kh.seed({ pantry: [], aisles: [] });
    vi.mocked(kh.client().savePantryItems).mockImplementation(async (items) => items);
    vi.mocked(kh.client().saveAisle).mockResolvedValue(newAisle);

    await kh.callTool("add_pantry_items", { items: [{ ingredient: "Dragon Fruit", aisle: "Exotic" }] });

    expect(kh.client().saveAisle).toHaveBeenCalledOnce();
    const [savedItem] = vi.mocked(kh.client().savePantryItems).mock.calls[0]?.[0] ?? [];
    expect(savedItem?.aisle).toBe("Exotic");
    expect(savedItem?.aisleUid).toBe("AISLE-EX");
    // The new aisle is persisted to the aisle store via ensureAisle.
    expect((kh.selfOf("aisle") as AisleSelf).store.resolveByName("Exotic")).toBeDefined();
  });
});
