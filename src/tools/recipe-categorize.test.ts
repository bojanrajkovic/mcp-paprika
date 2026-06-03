import { fromAny } from "@total-typescript/shoehorn";
import { describe, expect, it, vi } from "vitest";

import { makeCategory, makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { categorizeRecipeInputSchema, registerCategorizeRecipeTool } from "./recipe-categorize.js";

/** Build a categorize_recipe ctx whose saveRecipe echoes the recipe it is given. */
function setup(
  recipes: NonNullable<Parameters<typeof seed>[1]["recipes"]>,
  categories: NonNullable<Parameters<typeof seed>[1]["categories"]>,
) {
  const saveRecipe = vi.fn().mockImplementation((r: unknown) => Promise.resolve(r));
  const notifySync = vi.fn().mockResolvedValue(undefined);
  const putRecipe = vi.fn();
  const flush = vi.fn().mockResolvedValue(undefined);
  const { server, callTool } = makeTestServer();
  const ctx = seed(
    makeCtx(new RecipeStore(), server, {
      client: fromAny({ saveRecipe, notifySync }),
      cache: fromAny({ recipes: { put: putRecipe }, flush }),
    }),
    { recipes, categories },
  );
  registerCategorizeRecipeTool(server, ctx);
  return { callTool, saveRecipe };
}

describe("categorize_recipe tool", () => {
  it("add (default mode) unions the new category with the recipe's existing ones", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    const { callTool, saveRecipe } = setup([recipe], [catA, catB]);

    await callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"] });

    const saved = saveRecipe.mock.calls[0]?.[0];
    expect(saved?.categories).toEqual([catA.uid, catB.uid]);
  });

  it("add does not duplicate a category the recipe already has", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    const { callTool, saveRecipe } = setup([recipe], [catA]);

    await callTool("categorize_recipe", { uid: recipe.uid, categories: [catA.uid], mode: "add" });

    expect(saveRecipe.mock.calls[0]?.[0]?.categories).toEqual([catA.uid]);
  });

  it("replace sets the recipe's categories to exactly the provided ones", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    const { callTool, saveRecipe } = setup([recipe], [catA, catB]);

    await callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"], mode: "replace" });

    const saved = saveRecipe.mock.calls[0]?.[0];
    expect(saved?.categories).toEqual([catB.uid]);
    expect(saved?.categories).not.toContain(catA.uid);
  });

  it("remove drops the named category and keeps the rest", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const catB = makeCategory({ name: "Quick" });
    const recipe = makeRecipe({ categories: [catA.uid, catB.uid] });
    const { callTool, saveRecipe } = setup([recipe], [catA, catB]);

    await callTool("categorize_recipe", { uid: recipe.uid, categories: ["Quick"], mode: "remove" });

    expect(saveRecipe.mock.calls[0]?.[0]?.categories).toEqual([catA.uid]);
  });

  it("warns and leaves the recipe unchanged when every reference is unknown", async () => {
    const catA = makeCategory({ name: "Dinner" });
    const recipe = makeRecipe({ categories: [catA.uid] });
    const { callTool, saveRecipe } = setup([recipe], [catA]);

    const result = await callTool("categorize_recipe", {
      uid: recipe.uid,
      categories: ["Nonexistent"],
      mode: "replace",
    });
    const text = getText(result);

    expect(text).toContain("not found");
    expect(text).toContain("left unchanged");
    expect(saveRecipe).not.toHaveBeenCalled();
  });

  it("returns a not-found message for an unknown recipe UID", async () => {
    const { callTool, saveRecipe } = setup([makeRecipe()], []);

    const result = await callTool("categorize_recipe", { uid: "nope", categories: ["X"] });

    expect(getText(result).toLowerCase()).toContain("no recipe found");
    expect(saveRecipe).not.toHaveBeenCalled();
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
