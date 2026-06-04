import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeSelf } from "../module.js";

import { makeRecipe } from "../../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { favoriteRecipeInputSchema, unfavoriteRecipeInputSchema } from "./favorite.js";

describe("favorite_recipe tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("sets onFavorites true and renders markdown with On Favorites", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: true });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(updated);
    kh.seed({ recipes: [recipe] });

    const text = getText(await kh.callTool("favorite_recipe", { uid: recipe.uid }));

    expect(text).toContain("**On Favorites:** Yes");
    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]).toMatchObject({ onFavorites: true });
  });

  it("calls saveRecipe and notifySync exactly once each", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: true });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(updated);
    kh.seed({ recipes: [recipe] });

    await kh.callTool("favorite_recipe", { uid: recipe.uid });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("commits the updated recipe to the store and notifies (Content entity)", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: true });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(updated);
    kh.seed({ recipes: [recipe] });

    await kh.callTool("favorite_recipe", { uid: recipe.uid });

    expect((kh.self() as RecipeSelf).recipe.store.get(recipe.uid)?.onFavorites).toBe(true);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("unknown UID returns not-found message and skips the API call", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });

    const text = getText(await kh.callTool("favorite_recipe", { uid: "nonexistent-uid" }));

    expect(text).toContain('No recipe found with UID "nonexistent-uid" (it may not exist or was already deleted).');
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("saveRecipe throws — returns a failure message", async () => {
    const recipe = makeRecipe({ onFavorites: false });
    vi.mocked(kh.client().saveRecipe).mockRejectedValue(new Error("Network error"));
    kh.seed({ recipes: [recipe] });

    const text = getText(await kh.callTool("favorite_recipe", { uid: recipe.uid }));

    expect(text).toContain("Failed to favorite recipe");
    expect(text).toContain("Network error");
  });

  it("cold-start guard fires before any store lookup", async () => {
    // store never seeded — hasSynced is false
    const text = getText(await kh.callTool("favorite_recipe", { uid: "any-uid" }));

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("schema rejects unknown keys (.strict())", () => {
    expect(favoriteRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});

describe("unfavorite_recipe tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("sets onFavorites false and renders markdown without On Favorites", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: false });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(updated);
    kh.seed({ recipes: [recipe] });

    const text = getText(await kh.callTool("unfavorite_recipe", { uid: recipe.uid }));

    expect(text).not.toContain("**On Favorites:** Yes");
    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]).toMatchObject({ onFavorites: false });
  });

  it("calls saveRecipe and notifySync exactly once each", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: false });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(updated);
    kh.seed({ recipes: [recipe] });

    await kh.callTool("unfavorite_recipe", { uid: recipe.uid });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("commits the updated recipe to the store and notifies (Content entity)", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    const updated = makeRecipe({ uid: recipe.uid, onFavorites: false });
    vi.mocked(kh.client().saveRecipe).mockResolvedValue(updated);
    kh.seed({ recipes: [recipe] });

    await kh.callTool("unfavorite_recipe", { uid: recipe.uid });

    expect((kh.self() as RecipeSelf).recipe.store.get(recipe.uid)?.onFavorites).toBe(false);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("unknown UID returns not-found message and skips the API call", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });

    const text = getText(await kh.callTool("unfavorite_recipe", { uid: "nonexistent-uid" }));

    expect(text).toContain('No recipe found with UID "nonexistent-uid" (it may not exist or was already deleted).');
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("saveRecipe throws — returns a failure message", async () => {
    const recipe = makeRecipe({ onFavorites: true });
    vi.mocked(kh.client().saveRecipe).mockRejectedValue(new Error("Network error"));
    kh.seed({ recipes: [recipe] });

    const text = getText(await kh.callTool("unfavorite_recipe", { uid: recipe.uid }));

    expect(text).toContain("Failed to unfavorite recipe");
    expect(text).toContain("Network error");
  });

  it("cold-start guard fires before any store lookup", async () => {
    // store never seeded — hasSynced is false
    const text = getText(await kh.callTool("unfavorite_recipe", { uid: "any-uid" }));

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("schema rejects unknown keys (.strict())", () => {
    expect(unfavoriteRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});
