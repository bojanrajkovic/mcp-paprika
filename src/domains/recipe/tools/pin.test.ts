import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { pinRecipeInputSchema, unpinRecipeInputSchema } from "./pin.js";

describe("pin_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("sets isPinned true and renders markdown with Pinned", async () => {
    const recipe = makeRecipe({ isPinned: false });
    const updated = makeRecipe({ uid: recipe.uid, isPinned: true });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    const text = await kh.callToolText("pin_recipe", { uid: recipe.uid });

    expect(text).toContain("**Pinned:** Yes");
    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]).toMatchObject({ isPinned: true });
  });

  it("commits the updated recipe to the store and notifies (Content entity)", async () => {
    const recipe = makeRecipe({ isPinned: false });
    const updated = makeRecipe({ uid: recipe.uid, isPinned: true });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("pin_recipe", { uid: recipe.uid });

    expect(kh.state().recipe.store.get(recipe.uid)?.isPinned).toBe(true);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("unknown UID returns not-found message and skips the API call", async () => {
    kh.seed({ recipes: [makeRecipe()] });

    const text = await kh.callToolText("pin_recipe", { uid: "nonexistent-uid" });

    expect(text).toContain('No recipe found with UID "nonexistent-uid" (it may not exist or was already deleted).');
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("saveRecipe errs — returns a failure message", async () => {
    const recipe = makeRecipe({ isPinned: false });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("Network error")));
    kh.seed({ recipes: [recipe] });

    const text = await kh.callToolText("pin_recipe", { uid: recipe.uid });

    expect(text).toContain("Failed to pin recipe");
    expect(text).toContain("Network error");
  });

  it("cold-start guard fires before any store lookup", async () => {
    const text = await kh.callToolText("pin_recipe", { uid: "any-uid" });

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("schema rejects unknown keys (.strict())", () => {
    expect(pinRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});

describe("unpin_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("sets isPinned false and renders markdown without Pinned", async () => {
    const recipe = makeRecipe({ isPinned: true });
    const updated = makeRecipe({ uid: recipe.uid, isPinned: false });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    const text = await kh.callToolText("unpin_recipe", { uid: recipe.uid });

    expect(text).not.toContain("**Pinned:** Yes");
    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]).toMatchObject({ isPinned: false });
  });

  it("commits the updated recipe to the store and notifies (Content entity)", async () => {
    const recipe = makeRecipe({ isPinned: true });
    const updated = makeRecipe({ uid: recipe.uid, isPinned: false });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("unpin_recipe", { uid: recipe.uid });

    expect(kh.state().recipe.store.get(recipe.uid)?.isPinned).toBe(false);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("unknown UID returns not-found message and skips the API call", async () => {
    kh.seed({ recipes: [makeRecipe()] });

    const text = await kh.callToolText("unpin_recipe", { uid: "nonexistent-uid" });

    expect(text).toContain('No recipe found with UID "nonexistent-uid" (it may not exist or was already deleted).');
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("saveRecipe errs — returns a failure message", async () => {
    const recipe = makeRecipe({ isPinned: true });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("Network error")));
    kh.seed({ recipes: [recipe] });

    const text = await kh.callToolText("unpin_recipe", { uid: recipe.uid });

    expect(text).toContain("Failed to unpin recipe");
    expect(text).toContain("Network error");
  });

  it("cold-start guard fires before any store lookup", async () => {
    const text = await kh.callToolText("unpin_recipe", { uid: "any-uid" });

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("schema rejects unknown keys (.strict())", () => {
    expect(unpinRecipeInputSchema.safeParse({ uid: "abc-123", bogus: 1 }).success).toBe(false);
  });
});
