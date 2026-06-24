import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { rateRecipeInputSchema } from "./rate.js";

describe("rate_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("sets rating and the text JSON carries the updated rating", async () => {
    const recipe = makeRecipe({ rating: 0 });
    const updated = makeRecipe({ uid: recipe.uid, rating: 4 });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    const json = await kh.callToolJson("rate_recipe", { uid: recipe.uid, rating: 4 });

    expect(json).toMatchObject({ uid: recipe.uid, rating: 4 });
    expect(kh.client().saveRecipe).toHaveBeenCalledWith(expect.objectContaining({ rating: 4 }));
  });

  it("carries structuredContent with the rated recipe's machine fields", async () => {
    const recipe = makeRecipe({ rating: 0 });
    const updated = makeRecipe({ uid: recipe.uid, rating: 4 });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("rate_recipe", { uid: recipe.uid, rating: 4 });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ uid: updated.uid, rating: 4 });
  });

  it("unknown uid is an isError result with no structuredContent and skips saveRecipe", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("rate_recipe", { uid: "nonexistent-uid", rating: 3 });

    expect(getText(result)).toContain(
      'No recipe found with UID "nonexistent-uid" (it may not exist or was already deleted). Use `search_recipes` to find it.',
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
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

    const result = await kh.callTool("rate_recipe", { uid: recipe.uid, rating: 3 });

    expect(getText(result)).toContain("Failed to rate recipe");
    expect(getText(result)).toContain("Network error");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
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
