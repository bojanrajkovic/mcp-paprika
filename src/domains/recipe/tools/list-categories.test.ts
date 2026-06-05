import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CategoryUid } from "../../../ids.js";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

describe("list_categories tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns all categories with non-trashed recipe counts", async () => {
    const catA = makeCategory({ name: "Desserts" });
    const catB = makeCategory({ name: "Mains" });
    kh.seed({
      recipes: [
        makeRecipe({ categories: [catA.uid] }),
        makeRecipe({ categories: [catA.uid] }),
        makeRecipe({ categories: [catB.uid] }),
        // Trashed recipe — should NOT count
        makeRecipe({ categories: [catA.uid], inTrash: true }),
      ],
      categories: [catA, catB],
    });

    const text = await kh.callToolText("list_categories", {});

    // Desserts has 2 non-trashed recipes (trashed one excluded)
    expect(text).toContain("Desserts");
    expect(text).toContain("2 recipes");
    // Mains has 1 recipe
    expect(text).toContain("Mains");
    expect(text).toContain("1 recipe");
  });

  it("categories sorted alphabetically by name", async () => {
    const catZ = makeCategory({ name: "Zucchini Dishes" });
    const catA = makeCategory({ name: "Appetizers" });
    const catM = makeCategory({ name: "Main Courses" });
    kh.seed({
      // Need at least one recipe so store.size > 0 (cold-start guard)
      recipes: [makeRecipe({ categories: [] as Array<CategoryUid> })],
      categories: [catZ, catA, catM],
    });

    const text = await kh.callToolText("list_categories", {});

    const posA = text.indexOf("Appetizers");
    const posM = text.indexOf("Main Courses");
    const posZ = text.indexOf("Zucchini Dishes");

    expect(posA).toBeLessThan(posM);
    expect(posM).toBeLessThan(posZ);
  });

  it("category with zero non-trashed recipes appears with count 0", async () => {
    const catEmpty = makeCategory({ name: "Empty Category" });
    const catFull = makeCategory({ name: "Full Category" });
    kh.seed({
      recipes: [makeRecipe({ categories: [catFull.uid] })],
      categories: [catEmpty, catFull],
    });

    const text = await kh.callToolText("list_categories", {});

    expect(text).toContain("Empty Category");
    expect(text).toContain("0 recipes");
    expect(text).toContain("Full Category");
    expect(text).toContain("1 recipe");
  });

  it("empty recipe store returns cold-start error", async () => {
    // Recipe store not seeded — size === 0
    const text = await kh.callToolText("list_categories", {});
    expect(text.toLowerCase()).toContain("try again");
  });

  it("includes UIDs in output", async () => {
    const cat = makeCategory({ uid: "cat-uid-1" as CategoryUid, name: "Desserts" });
    kh.seed({
      recipes: [makeRecipe({ categories: [cat.uid] })],
      categories: [cat],
    });

    const text = await kh.callToolText("list_categories", {});
    expect(text).toContain("uid: `cat-uid-1`");
  });

  it("renders child categories indented under parents", async () => {
    const parent = makeCategory({ uid: "parent-1" as CategoryUid, name: "Baking", parentUid: null });
    const child = makeCategory({ uid: "child-1" as CategoryUid, name: "Cakes", parentUid: "parent-1" });
    kh.seed({
      recipes: [makeRecipe({ categories: [parent.uid, child.uid] })],
      categories: [parent, child],
    });

    const text = await kh.callToolText("list_categories", {});

    expect(text).toContain("- **Baking**");
    expect(text).toContain("  - **Cakes**");
  });

  it("renders an orphaned category (dangling parentUid) at top level with a warning disclosure", async () => {
    const orphan = makeCategory({ uid: "curries" as CategoryUid, name: "Curries", parentUid: "missing-parent" });
    const root = makeCategory({ uid: "beef" as CategoryUid, name: "Beef", parentUid: null });
    kh.seed({
      recipes: [makeRecipe({ categories: [orphan.uid] })],
      categories: [orphan, root],
    });

    const text = await kh.callToolText("list_categories", {});

    // Orphan is NOT silently hidden, renders at top level (no indent), flagged.
    expect(text).toContain("- **Curries**");
    expect(text).toContain("⚠️");
    expect(text).toContain("missing-parent");
    // Sanity: a normal root still renders without the orphan marker.
    expect(text).toContain("- **Beef**");
    const beefLine = text.split("\n").find((l) => l.includes("**Beef**"));
    expect(beefLine).not.toContain("⚠️");
  });

  it("store with recipes but no categories returns empty message", async () => {
    kh.seed({
      recipes: [makeRecipe({ categories: [] as Array<CategoryUid> })],
      categories: [], // synced, but empty catalog
    });

    const result = await kh.callTool("list_categories", {});
    const text = getText(result);

    expect(result.isError).toBeFalsy();
    expect(text.toLowerCase()).toContain("no categories");
  });

  it("recipe store synced but category catalog not yet synced returns a wait hint", async () => {
    // categoryStore intentionally not seeded → hasSynced === false
    kh.seed({
      recipes: [makeRecipe({ categories: [] as Array<CategoryUid> })],
      // categories omitted — store has hasSynced === false
    });

    const text = await kh.callToolText("list_categories", {});
    expect(text.toLowerCase()).toContain("still syncing");
  });
});
