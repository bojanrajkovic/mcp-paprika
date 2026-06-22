import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AisleUid } from "../aisle/ids.js";
import type { PantryApi } from "./api.js";
import type { PantryItemUid } from "./ids.js";
import type { PantryState } from "./module.js";

import { makeAisle } from "../../../test/domains/aisle/__fixtures__/aisles.js";
import { makePantryItem } from "../../../test/domains/pantry/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";

/**
 * Drives `PantryApi.itemsToRows` against the real built module: the cross-domain row
 * projection that grocery's move consumes via `ctx.deps.pantry`. The harness builds the
 * pantry module with its real aisle dep, so the method resolves aisle display names
 * through the live catalog exactly as it does in production.
 */
describe("PantryApi.itemsToRows", () => {
  const kh = useKernelHarness<PantryState>("pantry");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("projects items to rows, resolving the aisle display name through the live catalog", () => {
    kh.seed({
      aisles: [makeAisle({ uid: "aisle-dairy" as AisleUid, name: "Dairy" })],
      pantry: [],
    });
    const api = kh.apiOf("pantry") as PantryApi;

    const rows = api.itemsToRows([
      makePantryItem({
        uid: "p-milk" as PantryItemUid,
        ingredient: "Milk",
        quantity: "1 gal",
        aisleUid: "aisle-dairy" as AisleUid,
        inStock: true,
        expirationDate: null,
      }),
      makePantryItem({
        uid: "p-eggs" as PantryItemUid,
        ingredient: "Eggs",
        quantity: "",
        aisle: "",
        aisleUid: "",
        inStock: false,
        expirationDate: "2026-12-01",
      }),
    ]);

    expect(rows).toEqual([
      { uid: "p-milk", ingredient: "Milk", quantity: "1 gal", aisle: "Dairy", inStock: true, expirationDate: null },
      { uid: "p-eggs", ingredient: "Eggs", quantity: null, aisle: null, inStock: false, expirationDate: "2026-12-01" },
    ]);
  });

  it("returns an empty array for no items", () => {
    kh.seed({ aisles: [], pantry: [] });
    const api = kh.apiOf("pantry") as PantryApi;
    expect(api.itemsToRows([])).toEqual([]);
  });
});
