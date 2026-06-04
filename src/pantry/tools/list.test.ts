import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PantrySelf } from "../module.js";

import { makePantryItem } from "../../../test/cache/__fixtures__/pantry.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";
import { getText } from "../../../test/support/tool-test-utils.js";

describe("list_pantry_items tool", () => {
  const kh = useKernelHarness("pantry");
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

    const text = getText(await kh.callTool("list_pantry_items", {}));

    expect(text).toContain("You have 3 pantry items");

    // Alphabetical ordering: Apples before Milk before Sugar.
    const applesIdx = text.indexOf("Apples");
    const milkIdx = text.indexOf("Milk");
    const sugarIdx = text.indexOf("Sugar");

    expect(applesIdx).toBeGreaterThan(-1);
    expect(milkIdx).toBeGreaterThan(-1);
    expect(sugarIdx).toBeGreaterThan(-1);
    expect(applesIdx).toBeLessThan(milkIdx);
    expect(milkIdx).toBeLessThan(sugarIdx);

    // UIDs are present so the caller can chain follow-up operations.
    const items = (kh.self() as PantrySelf).store.getAll();
    for (const item of items) {
      expect(text).toContain(item.uid);
    }
  });

  it("returns friendly message for empty pantry", async () => {
    kh.seed({ pantry: [] });

    const text = getText(await kh.callTool("list_pantry_items", {}));

    expect(text).toBe("Your pantry is empty.");
  });

  it("cold-start (hasSynced false) returns guard error", async () => {
    // Store never seeded — hasSynced remains false.
    const text = getText(await kh.callTool("list_pantry_items", {}));

    expect(text.toLowerCase()).toContain("not yet synced");
  });
});
