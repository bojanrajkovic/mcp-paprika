import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { updateRecipeInputSchema } from "./update.js";

describe("update_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("provided fields are updated, omitted fields retain existing values", async () => {
    const recipe = makeRecipe({ name: "Old Name", servings: "2" });
    const updated = makeRecipe({ ...recipe, name: "New Name", servings: "2" });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("update_recipe", { uid: recipe.uid, name: "New Name" });

    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.name).toBe("New Name");
    expect(callArgs?.servings).toBe("2"); // unchanged from existing
  });

  it("existing categories are preserved untouched when not provided", async () => {
    const catA = makeCategory({ name: "Category A" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    const updated = makeRecipe({ ...recipe, name: "New Name", categories: [catA.uid] });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe], categories: [catA] });

    await kh.callTool("update_recipe", { uid: recipe.uid, name: "New Name" });

    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.categories).toEqual([catA.uid]); // categories are not touched by update_recipe
  });

  it("saveRecipe and notifySync are each called exactly once with the merged recipe", async () => {
    const recipe = makeRecipe({ name: "Old", servings: "4" });
    const updated = makeRecipe({ ...recipe, name: "New", servings: "4" });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("update_recipe", { uid: recipe.uid, name: "New" });

    expect(kh.client().saveRecipe).toHaveBeenCalledOnce();
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.name).toBe("New");
    expect(callArgs?.servings).toBe("4");
  });

  it("UID not found returns a not-found message and skips the API call", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });

    const text = await kh.callToolText("update_recipe", { uid: "nonexistent-uid", name: "New" });

    expect(text.toLowerCase()).toContain("no recipe found");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("saveRecipe throws — returns an error message and store is not updated", async () => {
    const recipe = makeRecipe();
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("Conflict")));
    kh.seed({ recipes: [recipe] });
    const before = kh.state().recipe.store.size;

    const text = await kh.callToolText("update_recipe", { uid: recipe.uid, name: "New" });

    expect(text).toContain("Failed to update");
    expect(text).toContain("Conflict");
    // Store unchanged: no commit happened.
    expect(kh.state().recipe.store.size).toBe(before);
  });

  it("cold-start guard fires before any store lookup", async () => {
    // store never seeded — hasSynced is false
    const text = await kh.callToolText("update_recipe", { uid: "any-uid", name: "New" });

    expect(text.toLowerCase()).toContain("try again");
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("notes field is updated when provided", async () => {
    const recipe = makeRecipe({ notes: null });
    const updated = makeRecipe({ ...recipe, notes: "test note" });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("update_recipe", { uid: recipe.uid, notes: "test note" });

    const callArgs = vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0];
    expect(callArgs?.notes).toBe("test note");
  });

  it("commits the saved recipe to the store and fires the Content resource-list notifier", async () => {
    const recipe = makeRecipe({ name: "Old Name" });
    const updated = makeRecipe({ ...recipe, name: "Updated Name" });
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(updated));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("update_recipe", { uid: recipe.uid, name: "Updated Name" });

    expect(kh.state().recipe.store.get(updated.uid)?.name).toBe("Updated Name");
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });
});

// The promoted-state fields left update_recipe for their own intent verbs. The schema is
// `.strict()`, so passing one is a hard rejection rather than a silently dropped key —
// the model can't "win" by patching the field on the generic editor.
describe("update_recipe input schema rejects promoted fields", () => {
  it("rejects rating (promoted to rate_recipe)", () => {
    expect(updateRecipeInputSchema.safeParse({ uid: "recipe-1", rating: 5 }).success).toBe(false);
  });

  it("rejects categories (promoted to categorize_recipe)", () => {
    expect(updateRecipeInputSchema.safeParse({ uid: "recipe-1", categories: ["Dinner"] }).success).toBe(false);
  });

  it("rejects inTrash (promoted to trash_recipe / restore_recipe)", () => {
    expect(updateRecipeInputSchema.safeParse({ uid: "recipe-1", inTrash: true }).success).toBe(false);
  });

  it("accepts a content-only update", () => {
    expect(updateRecipeInputSchema.safeParse({ uid: "recipe-1", name: "New", notes: "n" }).success).toBe(true);
  });
});
