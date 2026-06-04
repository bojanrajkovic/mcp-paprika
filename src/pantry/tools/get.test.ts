import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makePantryItem } from "../../../test/cache/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";
import { getText } from "../../../test/support/tool-test-utils.js";

describe("read_pantry_item tool", () => {
  const kh = useKernelHarness("pantry");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("UID lookup returns full item details as markdown", async () => {
    const item = makePantryItem({ ingredient: "Olive Oil" });
    kh.seed({ pantry: [item] });

    const text = getText(await kh.callTool("read_pantry_item", { lookup: { uid: item.uid } }));

    expect(text).toContain(`# ${item.ingredient}`);
    expect(text).toContain(item.uid);
  });

  it("single fuzzy match by ingredient name returns item details", async () => {
    kh.seed({
      pantry: [makePantryItem({ ingredient: "Brown Sugar" }), makePantryItem({ ingredient: "Flour" })],
    });

    const text = getText(await kh.callTool("read_pantry_item", { lookup: { ingredient: "Brown" } }));

    expect(text).toContain("# Brown Sugar");
  });

  it("multiple fuzzy matches return a disambiguation list with all names and UIDs", async () => {
    const items = [
      makePantryItem({ ingredient: "Apple Pie Filling" }),
      makePantryItem({ ingredient: "Apple Cider" }),
      makePantryItem({ ingredient: "Apple Sauce" }),
    ];
    kh.seed({ pantry: items });

    const text = getText(await kh.callTool("read_pantry_item", { lookup: { ingredient: "Apple" } }));

    expect(text).toContain("Apple Pie Filling");
    expect(text).toContain("Apple Cider");
    expect(text).toContain("Apple Sauce");
    for (const item of items) {
      expect(text).toContain(item.uid);
    }
    expect(text).toContain("Multiple pantry items match");
    expect(text).toContain("re-invoke with a specific uid");
  });

  it("unknown UID returns a not-found message", async () => {
    const item = makePantryItem();
    kh.seed({ pantry: [item] });

    const text = getText(await kh.callTool("read_pantry_item", { lookup: { uid: "does-not-exist" } }));

    expect(text.toLowerCase()).toContain("no pantry item found");
  });

  it("unknown ingredient name returns a not-found message", async () => {
    const item = makePantryItem();
    kh.seed({ pantry: [item] });

    const text = getText(await kh.callTool("read_pantry_item", { lookup: { ingredient: "Caviar" } }));

    expect(text.toLowerCase()).toContain("no pantry items found matching");
  });

  it("cold-start (hasSynced false) returns the not-yet-synced guard error", async () => {
    // store never seeded — hasSynced remains false
    const text = getText(await kh.callTool("read_pantry_item", { lookup: { uid: "anything" } }));

    expect(text.toLowerCase()).toContain("not yet synced");
  });
});
