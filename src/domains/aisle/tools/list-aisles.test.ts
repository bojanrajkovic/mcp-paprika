import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AisleUid } from "../ids.js";

import { makeAisle } from "../../../../test/domains/aisle/__fixtures__/aisles.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("list_aisles tool", () => {
  const kh = useKernelHarness("aisle");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("cold-start guard fires when aisle store not yet synced", async () => {
    // store never seeded — hasSynced is false
    const text = await kh.callToolText("list_aisles", {});
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("empty aisle list returns an empty items array", async () => {
    kh.seed({ aisles: [] });

    const { items } = await kh.callToolJson<{ items: Array<unknown> }>("list_aisles", {});
    expect(items).toEqual([]);
  });

  it("aisles sorted by orderFlag ascending", async () => {
    const a1 = makeAisle({ name: "Produce", orderFlag: 3 });
    const a2 = makeAisle({ name: "Dairy", orderFlag: 1 });
    const a3 = makeAisle({ name: "Bakery", orderFlag: 2 });
    kh.seed({ aisles: [a1, a2, a3] });

    const text = await kh.callToolText("list_aisles", {});
    const dairyIdx = text.indexOf("Dairy");
    const bakeryIdx = text.indexOf("Bakery");
    const produceIdx = text.indexOf("Produce");
    expect(dairyIdx).toBeLessThan(bakeryIdx);
    expect(bakeryIdx).toBeLessThan(produceIdx);
  });

  it("aisles with same orderFlag sorted by name", async () => {
    const a1 = makeAisle({ name: "Produce", orderFlag: 1 });
    const a2 = makeAisle({ name: "Dairy", orderFlag: 1 });
    kh.seed({ aisles: [a1, a2] });

    const text = await kh.callToolText("list_aisles", {});
    expect(text.indexOf("Dairy")).toBeLessThan(text.indexOf("Produce"));
  });

  it("output includes the aisle name and UID in the JSON text", async () => {
    const aisle = makeAisle({ name: "Bakery", orderFlag: 1 });
    kh.seed({ aisles: [aisle] });

    const { items } = await kh.callToolJson<{ items: Array<{ uid: string; name: string }> }>("list_aisles", {});
    expect(items[0]).toEqual({ uid: aisle.uid, name: "Bakery" });
  });

  it("emits structured rows with uid and name (R1)", async () => {
    kh.seed({
      aisles: [makeAisle({ uid: "a-produce" as AisleUid, name: "Produce", orderFlag: 0 })],
    });
    const result = await kh.callTool("list_aisles", {});
    expect(result.isError).toBeFalsy();
    const { items } = result.structuredContent as { items: Array<Record<string, unknown>> };
    expect(items).toEqual([{ uid: "a-produce", name: "Produce" }]);
  });

  it("returns one row per aisle", async () => {
    const a1 = makeAisle({ name: "Produce", orderFlag: 1 });
    const a2 = makeAisle({ name: "Dairy", orderFlag: 2 });
    kh.seed({ aisles: [a1, a2] });

    const { items } = await kh.callToolJson<{ items: Array<unknown> }>("list_aisles", {});
    expect(items).toHaveLength(2);
  });
});
