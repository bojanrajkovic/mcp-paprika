import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { categorizeRecipeInputSchema } from "./categorize.js";

describe("categorize_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("add (default mode) unions the new category with the recipe's existing ones", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA, catB] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => okAsync(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"] });

    const saved = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(saved?.categories).toEqual([catA.uid, catB.uid]);
  });

  it("add does not duplicate a category the recipe already has", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => okAsync(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: [catA.uid], mode: "add" });

    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]?.categories).toEqual([catA.uid]);
  });

  it("replace sets the recipe's categories to exactly the provided ones", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA, catB] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => okAsync(r));

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
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => okAsync(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"], mode: "remove" });

    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]?.categories).toEqual([catA.uid]);
  });

  it("carries structuredContent with the recategorized recipe's machine fields", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA, catB] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => okAsync(r));

    const result = await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"], mode: "add" });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      uid: recipe.uid,
      categoryUids: [catA.uid, catB.uid],
      categories: ["Dinner", "Quick"],
    });
  });

  it("every reference unknown is an isError result with no structuredContent and no save", async () => {
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
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("an unknown recipe UID is an isError result with no structuredContent", async () => {
    kh.seed({ recipes: [makeRecipe()], categories: [] });

    const result = await kh.callTool("categorize_recipe", { uid: "nope", categories: ["X"] });

    expect(getText(result).toLowerCase()).toContain("no recipe found");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("commits the updated recipe to the store and notifies (Content entity)", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    kh.seed({ recipes: [recipe], categories: [catA, catB] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => okAsync(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"], mode: "add" });

    const stored = kh.state().recipe.store.get(recipe.uid);
    expect(stored?.categories).toEqual([catA.uid, catB.uid]);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("calls saveRecipe and notifySync exactly once on a successful categorize", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const recipe = makeRecipe({ categories: [] });
    kh.seed({ recipes: [recipe], categories: [catA] });
    vi.mocked(kh.client().saveRecipe).mockImplementation((r) => okAsync(r));

    await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Dinner"], mode: "add" });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("returns an error and does not commit when saveRecipe errs", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const recipe = makeRecipe({ categories: [] });
    kh.seed({ recipes: [recipe], categories: [catA] });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("Network error")));

    const result = await kh.callTool("categorize_recipe", { uid: recipe.uid, categories: ["Dinner"], mode: "add" });

    expect(getText(result)).toContain("Failed to categorize recipe");
    expect(getText(result)).toContain("Network error");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    // Store is unchanged — categories still empty.
    expect(kh.state().recipe.store.get(recipe.uid)?.categories).toEqual([]);
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
