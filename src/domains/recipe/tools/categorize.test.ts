import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { categorizeRecipeInputSchema } from "./categorize.js";

describe("categorize_recipe tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("add (default mode) unions the new category with the recipe's existing ones", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA, catB] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => Promise.resolve(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"] });

    const saved = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(saved?.categories).toEqual([catA.uid, catB.uid]);
  });

  it("add does not duplicate a category the recipe already has", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => Promise.resolve(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: [catA.uid], mode: "add" });

    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]?.categories).toEqual([catA.uid]);
  });

  it("replace sets the recipe's categories to exactly the provided ones", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA, catB] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => Promise.resolve(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"], mode: "replace" });

    const saved = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(saved?.categories).toEqual([catB.uid]);
    expect(saved?.categories).not.toContain(catA.uid);
  });

  it("remove drops the named category and keeps the rest", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid, catB.uid] });
    kh.seed({ recipes: [recipe], categories: [catA, catB] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => Promise.resolve(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"], mode: "remove" });

    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]?.categories).toEqual([catA.uid]);
  });

  it("warns and leaves the recipe unchanged when every reference is unknown", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA] });

    const result = await kh.callTool("categorize_recipe", {
      uid: recipe.uid,
      categories: ["Nonexistent"],
      mode: "replace",
    });
    const text = getText(result);

    expect(text).toContain("not found");
    expect(text).toContain("left unchanged");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("returns a not-found message for an unknown recipe UID", async () => {
    kh.seed({ recipes: [makeRecipe()], categories: [] });

    const result = await kh.callTool("categorize_recipe", { uid: "nope", categories: ["X"] });

    expect(getText(result).toLowerCase()).toContain("no recipe found");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("commits the updated recipe to the store and notifies (Content entity)", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA, catB] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => Promise.resolve(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"], mode: "add" });

    const stored = (kh.state() as RecipeState).recipe.store.get(recipe.uid);
    expect(stored?.categories).toEqual([catA.uid, catB.uid]);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("calls saveRecipe and notifySync exactly once on a successful categorize", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const recipe = makeRecipe({ categories: [] });
    kh.seed({ recipes: [recipe], categories: [catA] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => Promise.resolve(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Dinner"], mode: "add" });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("returns an error and does not commit when saveRecipe throws", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const recipe = makeRecipe({ categories: [] });
    kh.seed({ recipes: [recipe], categories: [catA] });
    vi.mocked(kh.client().saveRecipe).mockRejectedValue(new Error("Network error"));

    const text = await kh.callToolText("categorize_recipe", { uid: recipe.uid, categories: ["Dinner"], mode: "add" });

    expect(text).toContain("Failed to categorize recipe");
    expect(text).toContain("Network error");
    // Store is unchanged — categories still empty.
    expect((kh.state() as RecipeState).recipe.store.get(recipe.uid)?.categories).toEqual([]);
  });

  it("fires the cold-start guard before any API call", async () => {
    // store never seeded — hasSynced is false
    const text = await kh.callToolText("categorize_recipe", { uid: "any-uid", categories: ["Dinner"] });

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  describe("input schema", () => {
    it("rejects an empty categories array", () => {
      expect(categorizeRecipeInputSchema.safeParse({ uid: "R", categories: [] }).success).toBe(false);
    });

    it("rejects unknown keys (strict)", () => {
      expect(categorizeRecipeInputSchema.safeParse({ uid: "R", categories: ["X"], bogus: 1 }).success).toBe(false);
    });

    it("defaults mode to add", () => {
      const parsed = categorizeRecipeInputSchema.parse({ uid: "R", categories: ["X"] });
      expect(parsed.mode).toBe("add");
    });
  });
});
