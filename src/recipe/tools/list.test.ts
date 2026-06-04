import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeRecipe } from "../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../test/support/kernel-harness.js";
import { getText } from "../../../test/support/tool-test-utils.js";

describe("list_recipes tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns recipe names sorted alphabetically", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Zucchini Soup" }), makeRecipe({ name: "Apple Crumble" })] });

    const text = getText(await kh.callTool("list_recipes", { offset: 0, limit: 25 }));

    const applePos = text.indexOf("Apple Crumble");
    const zucchiniPos = text.indexOf("Zucchini Soup");
    expect(applePos).toBeLessThan(zucchiniPos);
  });

  it("created date appears in each list entry", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", created: "2025-06-01T00:00:00Z" })] });

    const text = getText(await kh.callTool("list_recipes", { offset: 0, limit: 25 }));

    expect(text).toContain("2025-06-01");
  });

  it("rating appears in list entry when greater than zero", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", rating: 3 })] });

    const text = getText(await kh.callTool("list_recipes", { offset: 0, limit: 25 }));

    expect(text).toContain("3/5");
  });

  it("rating omitted from list entry when zero", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", rating: 0 })] });

    const text = getText(await kh.callTool("list_recipes", { offset: 0, limit: 25 }));

    expect(text).not.toContain("/5");
  });

  it("pinned marker appears when isPinned is true", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", isPinned: true })] });

    expect(getText(await kh.callTool("list_recipes", { offset: 0, limit: 25 }))).toContain("pinned");
  });

  it("pinned marker absent when isPinned is false", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", isPinned: false })] });

    expect(getText(await kh.callTool("list_recipes", { offset: 0, limit: 25 }))).not.toContain("pinned");
  });

  it("on-grocery-list marker appears when onGroceryList is true", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", onGroceryList: true })] });

    expect(getText(await kh.callTool("list_recipes", { offset: 0, limit: 25 }))).toContain("grocery list");
  });

  it("on-grocery-list marker absent when onGroceryList is false", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", onGroceryList: false })] });

    expect(getText(await kh.callTool("list_recipes", { offset: 0, limit: 25 }))).not.toContain("grocery list");
  });

  it("empty store returns cold-start message", async () => {
    // store never seeded — size === 0, hasSynced false
    const text = getText(await kh.callTool("list_recipes", { offset: 0, limit: 25 }));

    expect(text.toLowerCase()).toContain("try again");
  });

  it("pagination offset and limit are respected", async () => {
    kh.seed({
      recipes: Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1).padStart(2, "0")}` })),
    });

    const text = getText(await kh.callTool("list_recipes", { offset: 5, limit: 3 }));

    expect(text).toContain("Showing 3 of 10");
  });
});
