import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecipeUid } from "../ids.js";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

type ListRecipesPayload = {
  context: { source: string };
  items: Array<{
    uid: string;
    name: string;
    categories: string[];
    rating: number;
    totalTime: string | null;
    servings: string | null;
    isPinned: boolean;
    onGroceryList: boolean;
    created?: string;
    [k: string]: unknown;
  }>;
  total: number;
  offset: number;
};

describe("list_recipes tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("returns recipe names sorted alphabetically", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Zucchini Soup" }), makeRecipe({ name: "Apple Crumble" })] });

    const text = await kh.callToolText("list_recipes", { offset: 0, limit: 25 });

    const applePos = text.indexOf("Apple Crumble");
    const zucchiniPos = text.indexOf("Zucchini Soup");
    expect(applePos).toBeLessThan(zucchiniPos);
  });

  it("created date appears in each list entry", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", created: "2025-06-01T00:00:00Z" })] });

    const payload = await kh.callToolJson<ListRecipesPayload>("list_recipes", { offset: 0, limit: 25 });
    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.created).toBe("2025-06-01T00:00:00Z");
  });

  it("rating appears in list entry when greater than zero", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", rating: 3 })] });

    const payload = await kh.callToolJson<ListRecipesPayload>("list_recipes", { offset: 0, limit: 25 });

    expect(payload.items[0]!.rating).toBe(3);
  });

  it("rating omitted from list entry when zero", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", rating: 0 })] });

    const payload = await kh.callToolJson<ListRecipesPayload>("list_recipes", { offset: 0, limit: 25 });

    expect(payload.items[0]!.rating).toBe(0);
  });

  it("pinned marker appears when isPinned is true", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", isPinned: true })] });

    const payload = await kh.callToolJson<ListRecipesPayload>("list_recipes", { offset: 0, limit: 25 });
    expect(payload.items[0]!.isPinned).toBe(true);
  });

  it("pinned marker absent when isPinned is false", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", isPinned: false })] });

    const payload = await kh.callToolJson<ListRecipesPayload>("list_recipes", { offset: 0, limit: 25 });
    expect(payload.items[0]!.isPinned).toBe(false);
  });

  it("on-grocery-list marker appears when onGroceryList is true", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", onGroceryList: true })] });

    const payload = await kh.callToolJson<ListRecipesPayload>("list_recipes", { offset: 0, limit: 25 });
    expect(payload.items[0]!.onGroceryList).toBe(true);
  });

  it("on-grocery-list marker absent when onGroceryList is false", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta", onGroceryList: false })] });

    const payload = await kh.callToolJson<ListRecipesPayload>("list_recipes", { offset: 0, limit: 25 });
    expect(payload.items[0]!.onGroceryList).toBe(false);
  });

  it("empty store returns cold-start message", async () => {
    // store never seeded — size === 0, hasSynced false
    const text = await kh.callToolText("list_recipes", { offset: 0, limit: 25 });

    expect(text.toLowerCase()).toContain("try again");
  });

  it("pagination offset and limit are respected", async () => {
    kh.seed({
      recipes: Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1).padStart(2, "0")}` })),
    });

    const payload = await kh.callToolJson<ListRecipesPayload>("list_recipes", { offset: 5, limit: 3 });

    expect(payload.items).toHaveLength(3);
    expect(payload.total).toBe(10);
    expect(payload.offset).toBe(5);
  });

  it("emits structured recipe rows with uid, category names, and the pagination cursor (R1)", async () => {
    const cat = makeCategory({ name: "Dessert" });
    kh.seed({
      categories: [cat],
      recipes: [
        makeRecipe({
          uid: "r-1" as RecipeUid,
          name: "Cake",
          categories: [cat.uid],
          rating: 4,
          totalTime: "1 hour",
          servings: "8",
          isPinned: true,
        }),
      ],
    });

    const result = await kh.callTool("list_recipes", { offset: 0, limit: 25 });
    expect(result.isError).toBeFalsy();
    const payload = result.structuredContent as {
      items: Array<Record<string, unknown>>;
      total: number;
      offset: number;
    };
    expect(payload).toMatchObject({ context: { source: "list" }, total: 1, offset: 0 });
    expect(payload.items[0]).toMatchObject({
      uid: "r-1",
      name: "Cake",
      categories: ["Dessert"],
      rating: 4,
      totalTime: "1 hour",
      servings: "8",
      isPinned: true,
    });
  });

  it("over-paging past the end is an error, not an empty success", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Only One" })] });
    const result = await kh.callTool("list_recipes", { offset: 5, limit: 25 });
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain("Try a lower offset");
  });
});
