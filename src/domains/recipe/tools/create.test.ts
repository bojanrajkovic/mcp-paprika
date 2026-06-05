import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeCategory, makeRecipe } from "../../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

describe("create_recipe tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("required fields create a recipe returned as markdown", async () => {
    const savedRecipe = makeRecipe({ name: "Soup" });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(savedRecipe);
    kh.seed({ recipes: [makeRecipe()] });

    const text = getText(
      await kh.callTool("create_recipe", {
        name: "Soup",
        ingredients: "water, salt",
        directions: "boil water, add salt",
      }),
    );

    expect(text).toContain("# Soup");
    expect(text).toContain("## Ingredients");
    expect(text).toContain("## Directions");
    // The new recipe's UID is surfaced so the caller can chain upload_recipe_photo / update_recipe.
    expect(text).toContain(savedRecipe.uid);
  });

  it("mints an uppercase canonical UUID (Paprika's native format)", async () => {
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(makeRecipe());
    kh.seed({ recipes: [makeRecipe()] });

    await kh.callTool("create_recipe", { name: "Soup", ingredients: "water", directions: "boil" });

    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.uid).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  });

  it("reflects optional fields in the returned recipe", async () => {
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(
      makeRecipe({ name: "Pasta", description: "Tasty pasta", servings: "4", prepTime: "10 min" }),
    );
    kh.seed({ recipes: [makeRecipe()] });

    const text = getText(
      await kh.callTool("create_recipe", {
        name: "Pasta",
        ingredients: "pasta, sauce",
        directions: "boil and combine",
        description: "Tasty pasta",
        servings: "4",
        prepTime: "10 min",
      }),
    );

    expect(text).toContain("Tasty pasta");
    expect(text).toContain("**Servings:** 4");
    expect(text).toContain("Prep: 10 min");
  });

  it("defaults omitted optional fields to null", async () => {
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(makeRecipe());
    kh.seed({ recipes: [makeRecipe()] });

    await kh.callTool("create_recipe", { name: "Simple Recipe", ingredients: "one ingredient", directions: "do it" });

    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.description).toBe(null);
    expect(callArgs?.notes).toBe(null);
    expect(callArgs?.servings).toBe(null);
    expect(callArgs?.prepTime).toBe(null);
    expect(callArgs?.cookTime).toBe(null);
    expect(callArgs?.totalTime).toBe(null);
    expect(callArgs?.difficulty).toBe(null);
    expect(callArgs?.rating).toBe(0);
  });

  it("emits created in Paprika wire format, not ISO-8601 (regression #159)", async () => {
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(makeRecipe());
    kh.seed({ recipes: [makeRecipe()] });

    await kh.callTool("create_recipe", { name: "Dated Recipe", ingredients: "one ingredient", directions: "do it" });

    // Paprika's /sync/recipe/ rejects ISO-8601 `created` with HTTP 500; it requires
    // `yyyy-MM-dd HH:mm:ss` (no T, no Z, no millis).
    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.created).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(callArgs?.created).not.toContain("T");
    expect(callArgs?.created).not.toContain("Z");
  });

  it("resolves category names to UIDs", async () => {
    const category = makeCategory({ name: "Soups" });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(makeRecipe({ categories: [category.uid] }));
    kh.seed({ recipes: [makeRecipe()], categories: [category] });

    await kh.callTool("create_recipe", {
      name: "Soup",
      ingredients: "ingredients",
      directions: "directions",
      categories: ["Soups"],
    });

    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.categories).toContain(category.uid);
  });

  it("calls saveRecipe and notifySync exactly once each", async () => {
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(makeRecipe());
    kh.seed({ recipes: [makeRecipe()] });

    await kh.callTool("create_recipe", { name: "Recipe", ingredients: "ingredients", directions: "directions" });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("commits the saved recipe to the store and notifies (Content entity)", async () => {
    const savedRecipe = makeRecipe({ name: "Saved Recipe" });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(savedRecipe);
    kh.seed({ recipes: [makeRecipe()] });

    await kh.callTool("create_recipe", { name: "Saved Recipe", ingredients: "ingredients", directions: "directions" });

    // The recipe is committed to the (real) store, and the Content resource-list fires.
    expect((kh.state() as RecipeState).recipe.store.get(savedRecipe.uid)).toEqual(savedRecipe);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("skips an unknown category name with a warning", async () => {
    const category = makeCategory({ name: "Desserts" });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(makeRecipe({ categories: [category.uid] }));
    kh.seed({ recipes: [makeRecipe()], categories: [category] });

    const text = getText(
      await kh.callTool("create_recipe", {
        name: "Recipe",
        ingredients: "ingredients",
        directions: "directions",
        categories: ["Desserts", "UnknownCat"],
      }),
    );

    expect(text).toContain('Warning: category "UnknownCat" not found');
    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.categories).toEqual([category.uid]);
    expect(callArgs?.categories).not.toContain("UnknownCat");
  });

  it("returns an error and leaves the store untouched when saveRecipe throws", async () => {
    vi.mocked(kh.client().saveRecipe).mockRejectedValue(new Error("Network error"));
    kh.seed({ recipes: [makeRecipe()] });
    const before = (kh.state() as RecipeState).recipe.store.size;

    const text = getText(
      await kh.callTool("create_recipe", { name: "Recipe", ingredients: "ingredients", directions: "directions" }),
    );

    expect(text).toContain("Failed to create");
    expect(text).toContain("Network error");
    // No commit happened — store size unchanged.
    expect((kh.state() as RecipeState).recipe.store.size).toBe(before);
  });

  it("fires the cold-start guard before any API call", async () => {
    // store never seeded — size === 0
    const text = getText(
      await kh.callTool("create_recipe", { name: "Recipe", ingredients: "ingredients", directions: "directions" }),
    );

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });
});
