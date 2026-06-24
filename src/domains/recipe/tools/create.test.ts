import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("create_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("required fields create a recipe returned as JSON carrying the new UID", async () => {
    const savedRecipe = makeRecipe({ name: "Soup" });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(savedRecipe));
    kh.seed({ recipes: [makeRecipe()] });

    const parsed = await kh.callToolJson<{ uid: string; name: string; ingredients: string; directions: string }>(
      "create_recipe",
      { name: "Soup", ingredients: "water, salt", directions: "boil water, add salt" },
    );

    // The echo reflects the saved recipe; the body fields are present as keys.
    expect(parsed.name).toBe("Soup");
    expect(parsed).toHaveProperty("ingredients");
    expect(parsed).toHaveProperty("directions");
    // The new recipe's UID now rides the JSON text channel, so the model can chain on it.
    expect(parsed.uid).toBe(savedRecipe.uid);
  });

  it("mints an uppercase canonical UUID (Paprika's native format)", async () => {
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(makeRecipe()));
    kh.seed({ recipes: [makeRecipe()] });

    await kh.callTool("create_recipe", { name: "Soup", ingredients: "water", directions: "boil" });

    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.uid).toMatch(/^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/);
  });

  it("reflects optional fields in the returned recipe", async () => {
    vi.mocked(kh.client().saveRecipe).mockReturnValue(
      okAsync(makeRecipe({ name: "Pasta", description: "Tasty pasta", servings: "4", prepTime: "10 min" })),
    );
    kh.seed({ recipes: [makeRecipe()] });

    const text = await kh.callToolText("create_recipe", {
      name: "Pasta",
      ingredients: "pasta, sauce",
      directions: "boil and combine",
      description: "Tasty pasta",
      servings: "4",
      prepTime: "10 min",
    });

    const parsed = JSON.parse(text) as { description: string | null; servings: string | null; prepTime: string | null };
    expect(parsed.description).toBe("Tasty pasta");
    expect(parsed.servings).toBe("4");
    expect(parsed.prepTime).toBe("10 min");
  });

  it("defaults omitted optional fields to null", async () => {
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(makeRecipe()));
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
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(makeRecipe()));
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
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(makeRecipe({ categories: [category.uid] })));
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
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(makeRecipe()));
    kh.seed({ recipes: [makeRecipe()] });

    await kh.callTool("create_recipe", { name: "Recipe", ingredients: "ingredients", directions: "directions" });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("commits the saved recipe to the store and notifies (Content entity)", async () => {
    const savedRecipe = makeRecipe({ name: "Saved Recipe" });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(savedRecipe));
    kh.seed({ recipes: [makeRecipe()] });

    await kh.callTool("create_recipe", { name: "Saved Recipe", ingredients: "ingredients", directions: "directions" });

    // The recipe is committed to the (real) store, and the Content resource-list fires.
    expect(kh.state().recipe.store.get(savedRecipe.uid)).toEqual(savedRecipe);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("silently drops an unknown category name, keeping only the resolved ones", async () => {
    const category = makeCategory({ name: "Desserts" });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(makeRecipe({ categories: [category.uid] })));
    kh.seed({ recipes: [makeRecipe()], categories: [category] });

    const parsed = await kh.callToolJson<{ categoryUids: Array<string> }>("create_recipe", {
      name: "Recipe",
      ingredients: "ingredients",
      directions: "directions",
      categories: ["Desserts", "UnknownCat"],
    });

    // The unknown category is dropped (the per-call warning prose is gone); the recipe
    // carries only the resolved category, which the model sees in the JSON payload.
    expect(parsed.categoryUids).toEqual([category.uid]);
    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.categories).toEqual([category.uid]);
    expect(callArgs?.categories).not.toContain("UnknownCat");
  });

  it("returns an error and leaves the store untouched when saveRecipe errs", async () => {
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("Network error")));
    kh.seed({ recipes: [makeRecipe()] });
    const before = kh.state().recipe.store.size;

    const text = await kh.callToolText("create_recipe", {
      name: "Recipe",
      ingredients: "ingredients",
      directions: "directions",
    });

    expect(text).toContain("Failed to create");
    expect(text).toContain("Network error");
    // No commit happened — store size unchanged.
    expect(kh.state().recipe.store.size).toBe(before);
  });

  it("fires the cold-start guard before any API call", async () => {
    // store never seeded — size === 0
    const text = await kh.callToolText("create_recipe", {
      name: "Recipe",
      ingredients: "ingredients",
      directions: "directions",
    });

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("carries structuredContent with the new recipe's machine fields (B1/#321)", async () => {
    const savedRecipe = makeRecipe({ name: "Soup" });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(savedRecipe));
    kh.seed({ recipes: [makeRecipe()] });

    const result = await kh.callTool("create_recipe", {
      name: "Soup",
      ingredients: "water, salt",
      directions: "boil water, add salt",
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ uid: savedRecipe.uid, name: savedRecipe.name });
  });

  it("a saveRecipe failure is an isError result with no structuredContent (B1/#321)", async () => {
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("Network error")));
    kh.seed({ recipes: [makeRecipe()] });

    const result = await kh.callTool("create_recipe", {
      name: "Recipe",
      ingredients: "ingredients",
      directions: "directions",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });
});
