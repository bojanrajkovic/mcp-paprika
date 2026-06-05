import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("empty aisle list returns helpful message", async () => {
    kh.seed({ aisles: [] });

    const text = await kh.callToolText("list_aisles", {});
    expect(text.toLowerCase()).toContain("no aisles found");
    expect(text).toContain("Paprika");
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

  it("output includes aisle name in bold and UID in backticks", async () => {
    const aisle = makeAisle({ name: "Bakery", orderFlag: 1 });
    kh.seed({ aisles: [aisle] });

    const text = await kh.callToolText("list_aisles", {});
    expect(text).toContain(`**Bakery**`);
    expect(text).toContain(`\`${aisle.uid}\``);
  });

  it("each aisle is on its own line with dash prefix", async () => {
    const a1 = makeAisle({ name: "Produce", orderFlag: 1 });
    const a2 = makeAisle({ name: "Dairy", orderFlag: 2 });
    kh.seed({ aisles: [a1, a2] });

    const text = await kh.callToolText("list_aisles", {});
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/^- \*\*/);
    expect(lines[1]).toMatch(/^- \*\*/);
  });
});
