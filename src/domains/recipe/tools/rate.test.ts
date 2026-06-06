import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { rateRecipeInputSchema } from "./rate.js";

describe("rate_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("sets rating and renders markdown with updated star rating", async () => {
    const recipe = makeRecipe({ rating: 0 });
    const updated = makeRecipe({ uid: recipe.uid, rating: 4 });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    const text = await kh.callToolText("rate_recipe", { uid: recipe.uid, rating: 4 });

    expect(text).toContain("**Rating:** 4/5");
    expect(kh.client().saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ rating: 4 }));
  });

  it("unknown uid returns not-found message without calling saveRecipe", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });

    const text = await kh.callToolText("rate_recipe", { uid: "nonexistent-uid", rating: 3 });

    expect(text).toContain('No recipe found with UID "nonexistent-uid" (it may not exist or was already deleted).');
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("commits the rated recipe to the store (Content entity)", async () => {
    const recipe = makeRecipe({ rating: 0 });
    const updated = makeRecipe({ uid: recipe.uid, rating: 5 });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("rate_recipe", { uid: recipe.uid, rating: 5 });

    expect(kh.state().recipe.store.get(recipe.uid)?.rating).toBe(5);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("calls saveRecipe and notifySync exactly once each", async () => {
    const recipe = makeRecipe({ rating: 0 });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(makeRecipe({ uid: recipe.uid, rating: 2 })));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("rate_recipe", { uid: recipe.uid, rating: 2 });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("returns an error and leaves the store untouched when saveRecipe errs", async () => {
    const recipe = makeRecipe({ rating: 0 });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("Network error")));
    kh.seed({ recipes: [recipe] });
    const before = kh.state().recipe.store.get(recipe.uid)?.rating;

    const text = await kh.callToolText("rate_recipe", { uid: recipe.uid, rating: 3 });

    expect(text).toContain("Failed to rate recipe");
    expect(text).toContain("Network error");
    expect(kh.state().recipe.store.get(recipe.uid)?.rating).toBe(before);
  });

  it("fires the cold-start guard before any API call (empty store)", async () => {
    // store never seeded — size === 0, hasSynced false
    const text = await kh.callToolText("rate_recipe", { uid: "any-uid", rating: 3 });

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("schema: rejects unknown keys (.strict())", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: 3, bogus: 1 }).success).toBe(false);
  });

  it("schema: rejects out-of-range rating", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: 9 }).success).toBe(false);
  });

  it("schema: rejects rating below 0", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: -1 }).success).toBe(false);
  });

  it("schema: accepts rating 0 (clear)", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: 0 }).success).toBe(true);
  });

  it("schema: accepts rating 5 (max)", () => {
    expect(rateRecipeInputSchema.safeParse({ uid: "abc-123", rating: 5 }).success).toBe(true);
  });
});
