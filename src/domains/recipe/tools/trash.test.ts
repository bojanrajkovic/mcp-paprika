import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeState } from "../module.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

describe("trash_recipe tool", () => {
  const kh = useKernelHarness<RecipeState>("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("soft-deletes the recipe and returns confirmation with the recipe name", async () => {
    const recipe = makeRecipe({ name: "Pasta Carbonara" });
    const trashed = { ...recipe, inTrash: true };
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(trashed));
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("trash_recipe", { uid: recipe.uid });

    expect(getText(result)).toContain("Pasta Carbonara");
    expect(getText(result).toLowerCase()).toContain("trash");
    expect(kh.state().recipe.store.get(recipe.uid)?.inTrash).toBe(true);
    // The prose ack stays, but the now-trashed recipe rides structuredContent.
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ uid: recipe.uid, name: "Pasta Carbonara" });
  });

  it("calls saveRecipe with inTrash: true and notifySync exactly once", async () => {
    const recipe = makeRecipe({ name: "Pasta Carbonara" });
    const trashed = { ...recipe, inTrash: true };
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(trashed));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("trash_recipe", { uid: recipe.uid });

    expect(vi.mocked(kh.client().saveRecipe).mock.calls[0]?.[0]).toMatchObject({ inTrash: true });
    expect(kh.client().notifySync).toHaveBeenCalledOnce();
  });

  it("commits the trashed recipe to the store", async () => {
    const recipe = makeRecipe({ name: "Pasta Carbonara" });
    const trashed = { ...recipe, inTrash: true };
    vi.mocked(kh.client().saveRecipe).mockReturnValue(okAsync(trashed));
    kh.seed({ recipes: [recipe] });

    await kh.callTool("trash_recipe", { uid: recipe.uid });

    expect(kh.state().recipe.store.get(recipe.uid)?.inTrash).toBe(true);
  });

  it("UID not found is an isError result with no structuredContent and skips the API call", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("trash_recipe", { uid: "nonexistent-uid" });

    expect(getText(result).toLowerCase()).toContain("no recipe found");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("recipe already in trash is an idempotent success carrying the recipe's structuredContent", async () => {
    const nonTrashedRecipe = makeRecipe({ name: "Pasta Bolognese" });
    const trashedRecipe = makeRecipe({ name: "Trashed Recipe", inTrash: true });
    kh.seed({ recipes: [nonTrashedRecipe, trashedRecipe] });

    const result = await kh.callTool("trash_recipe", { uid: trashedRecipe.uid });

    expect(getText(result).toLowerCase()).toContain("already in the trash");
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ uid: trashedRecipe.uid, name: "Trashed Recipe" });
    expect(kh.client().saveRecipe).not.toHaveBeenCalled();
  });

  it("saveRecipe errs — an isError result with no structuredContent", async () => {
    const recipe = makeRecipe();
    vi.mocked(kh.client().saveRecipe).mockReturnValue(errAsync(new Error("API timeout")));
    kh.seed({ recipes: [recipe] });

    const result = await kh.callTool("trash_recipe", { uid: recipe.uid });

    expect(getText(result)).toContain("Failed to delete");
    expect(getText(result)).toContain("API timeout");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("cold-start guard fires before any store lookup", async () => {
    // store never seeded — hasSynced is false
    const text = await kh.callToolText("trash_recipe", { uid: "any-uid" });

    expect(text.toLowerCase()).toContain("try again");
  });
});
