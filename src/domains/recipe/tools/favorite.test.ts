import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { favoriteRecipeInputSchema, unfavoriteRecipeInputSchema } from "./favorite.js";

describe("favorite_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("sets onFavorites true and the text JSON carries onFavorites: true", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: true });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    const json = await kh.callToolJson("favorite_recipe", { uid: recipe.uid });

    expect(json).toMatchObject({ uid: recipe.uid, onFavorites: true });
    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]).toMatchObject({ onFavorites: true });
  });

  it("calls saveRecipe and notifySync exactly once each", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: true });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("favorite_recipe", { uid: recipe.uid });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("commits the updated recipe to the store and notifies (Content entity)", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: true });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("favorite_recipe", { uid: recipe.uid });

    expect(kh.state().recipe.store.get(recipe.uid)?.onFavorites).toBe(true);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("carries structuredContent with the favorited recipe's machine fields", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: true });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("favorite_recipe", { uid: recipe.uid });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ uid: updated.uid, onFavorites: true });
  });

  it("unknown UID is an isError result with no structuredContent and skips the API call", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("favorite_recipe", { uid: "nonexistent-uid" });

    expect(getText(result)).toContain(
      'No recipe found with UID "nonexistent-uid" (it may not exist or was already deleted). Use `search_recipes` to find it.',
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("saveRecipe errs — an isError result with no structuredContent", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("Network error")));
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("favorite_recipe", { uid: recipe.uid });

    expect(getText(result)).toContain("Failed to favorite recipe");
    expect(getText(result)).toContain("Network error");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("cold-start guard fires before any store lookup", async () => {
    // store never seeded — hasSynced is false
    const text = await kh.callToolText("favorite_recipe", { uid: "any-uid" });

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("schema rejects unknown keys (.strict())", () => {
    expect(favoriteRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});

describe("unfavorite_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("sets onFavorites false and the text JSON carries onFavorites: false", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: false });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    const json = await kh.callToolJson("unfavorite_recipe", { uid: recipe.uid });

    expect(json).toMatchObject({ uid: recipe.uid, onFavorites: false });
    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]).toMatchObject({ onFavorites: false });
  });

  it("calls saveRecipe and notifySync exactly once each", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: false });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("unfavorite_recipe", { uid: recipe.uid });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("commits the updated recipe to the store and notifies (Content entity)", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: false });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("unfavorite_recipe", { uid: recipe.uid });

    expect(kh.state().recipe.store.get(recipe.uid)?.onFavorites).toBe(false);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("carries structuredContent with the unfavorited recipe's machine fields", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: false });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("unfavorite_recipe", { uid: recipe.uid });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ uid: updated.uid, onFavorites: false });
  });

  it("unknown UID is an isError result with no structuredContent and skips the API call", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("unfavorite_recipe", { uid: "nonexistent-uid" });

    expect(getText(result)).toContain(
      'No recipe found with UID "nonexistent-uid" (it may not exist or was already deleted). Use `search_recipes` to find it.',
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("saveRecipe errs — an isError result with no structuredContent", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("Network error")));
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("unfavorite_recipe", { uid: recipe.uid });

    expect(getText(result)).toContain("Failed to unfavorite recipe");
    expect(getText(result)).toContain("Network error");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("cold-start guard fires before any store lookup", async () => {
    // store never seeded — hasSynced is false
    const text = await kh.callToolText("unfavorite_recipe", { uid: "any-uid" });

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("schema rejects unknown keys (.strict())", () => {
    expect(unfavoriteRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});
