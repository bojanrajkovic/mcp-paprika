import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CategoryUid } from "../ids.js";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

type ListCategoriesPayload = {
  items: Array<{ uid: string; name: string; recipeCount: number; parentUid: string | null }>;
};

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

    const payload = await kh.callToolJson<ListCategoriesPayload>("list_categories", {});

    // Desserts has 2 non-trashed recipes (trashed one excluded)
    const desserts = payload.items.find((i) => i.name === "Desserts");
    expect(desserts).toBeDefined();
    expect(desserts!.recipeCount).toBe(2);
    // Mains has 1 recipe
    const mains = payload.items.find((i) => i.name === "Mains");
    expect(mains).toBeDefined();
    expect(mains!.recipeCount).toBe(1);
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

    const payload = await kh.callToolJson<ListCategoriesPayload>("list_categories", {});

    const empty = payload.items.find((i) => i.name === "Empty Category");
    expect(empty).toBeDefined();
    expect(empty!.recipeCount).toBe(0);
    const full = payload.items.find((i) => i.name === "Full Category");
    expect(full).toBeDefined();
    expect(full!.recipeCount).toBe(1);
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

    const payload = await kh.callToolJson<ListCategoriesPayload>("list_categories", {});
    expect(payload.items.some((i) => i.uid === "cat-uid-1")).toBe(true);
  });

  it("emits structured category rows carrying uid, recipeCount, and parentUid (R1)", async () => {
    const parent = makeCategory({ uid: "p-1" as CategoryUid, name: "Baking", parentUid: null });
    const child = makeCategory({ uid: "c-1" as CategoryUid, name: "Cakes", parentUid: "p-1" });
    kh.seed({ recipes: [makeRecipe({ categories: [child.uid] })], categories: [parent, child] });

    const result = await kh.callTool("list_categories", {});
    expect(result.isError).toBeFalsy();
    const { items } = result.structuredContent as { items: Array<Record<string, unknown>> };
    // Flat, alphabetically sorted; the tree is reconstructable from parentUid.
    expect(items).toEqual([
      { uid: "p-1", name: "Baking", recipeCount: 0, parentUid: null },
      { uid: "c-1", name: "Cakes", recipeCount: 1, parentUid: "p-1" },
    ]);
  });

  it("normalizes a dangling parentUid to null in the structured rows (matches the text re-rooting)", async () => {
    const orphan = makeCategory({ uid: "curries" as CategoryUid, name: "Curries", parentUid: "missing-parent" });
    kh.seed({ recipes: [makeRecipe({ categories: [orphan.uid] })], categories: [orphan] });
    const result = await kh.callTool("list_categories", {});
    const { items } = result.structuredContent as { items: Array<Record<string, unknown>> };
    expect(items).toEqual([{ uid: "curries", name: "Curries", recipeCount: 1, parentUid: null }]);
  });

  it("renders child categories indented under parents", async () => {
    const parent = makeCategory({ uid: "parent-1" as CategoryUid, name: "Baking", parentUid: null });
    const child = makeCategory({ uid: "child-1" as CategoryUid, name: "Cakes", parentUid: "parent-1" });
    kh.seed({
      recipes: [makeRecipe({ categories: [parent.uid, child.uid] })],
      categories: [parent, child],
    });

    const payload = await kh.callToolJson<ListCategoriesPayload>("list_categories", {});

    // The tree is reconstructable from parentUid: parent has null, child references parent.
    const baking = payload.items.find((i) => i.name === "Baking");
    expect(baking).toBeDefined();
    expect(baking!.parentUid).toBeNull();
    const cakes = payload.items.find((i) => i.name === "Cakes");
    expect(cakes).toBeDefined();
    expect(cakes!.parentUid).toBe("parent-1");
  });

  it("renders an orphaned category (dangling parentUid) at top level with a warning disclosure", async () => {
    const orphan = makeCategory({ uid: "curries" as CategoryUid, name: "Curries", parentUid: "missing-parent" });
    const root = makeCategory({ uid: "beef" as CategoryUid, name: "Beef", parentUid: null });
    kh.seed({
      recipes: [makeRecipe({ categories: [orphan.uid] })],
      categories: [orphan, root],
    });

    const payload = await kh.callToolJson<ListCategoriesPayload>("list_categories", {});

    // Orphan is NOT silently hidden; its dangling parentUid is normalized to null
    // (top-level re-rooting), matching the text tree behavior.
    const curries = payload.items.find((i) => i.name === "Curries");
    expect(curries).toBeDefined();
    expect(curries!.parentUid).toBeNull();
    // Sanity: a normal root still appears with its own null parentUid.
    const beef = payload.items.find((i) => i.name === "Beef");
    expect(beef).toBeDefined();
    expect(beef!.parentUid).toBeNull();
  });

  it("store with recipes but no categories returns empty message", async () => {
    kh.seed({
      recipes: [makeRecipe({ categories: [] as Array<CategoryUid> })],
      categories: [], // synced, but empty catalog
    });

    const result = await kh.callTool("list_categories", {});
    expect(result.isError).toBeFalsy();
    // Empty catalog returns {items:[]} as compact JSON — not a text "no categories" message.
    const payload = JSON.parse(getText(result)) as ListCategoriesPayload;
    expect(payload.items).toHaveLength(0);
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
