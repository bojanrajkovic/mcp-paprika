import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { RecipeUid } from "../ids.js";
import type { CookRecipeInput } from "./cook.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

// A minimal flat (no-intermediate) parse for the given recipe UID. Typed as the tool's own
// CookRecipeInput so the test tracks the schema; the cast covers the not-found / cold-start
// cases that deliberately pass a non-resolving UID string.
function flatArgs(uid: string): CookRecipeInput {
  return {
    recipe_uid: uid as RecipeUid,
    ingredients: [
      { text: "2 cups flour", group: null },
      { text: "1 cup sugar", group: null },
    ],
    steps: [
      { text: "Mix flour and sugar.", group: null, ingredientRefs: [0, 1], produces: null, usesIntermediate: [] },
      { text: "Bake 30 minutes.", group: null, ingredientRefs: [], produces: null, usesIntermediate: [] },
    ],
  };
}

describe("cook_recipe tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  // A named type isn't assignable to Record<string, unknown> without an index signature
  // (only fresh object literals are), so spread into a literal at the call boundary.
  const callCook = (args: CookRecipeInput) => kh.callTool("cook_recipe", { ...args });

  it("echoes the validated parse and enriches it with the stored recipe's identity", async () => {
    const recipe = makeRecipe({ name: "Pound Cake", servings: "8", totalTime: "1 hr" });
    kh.seed({ recipes: [recipe] });
    const result = await callCook(flatArgs(recipe.uid));
    expect(result.isError).toBeUndefined();
    // The model's parse passes straight through; the server adds name/servings/totalTime.
    const sc = result.structuredContent as {
      ingredients: unknown[];
      steps: { text: string; ingredientRefs: number[] }[];
    };
    expect(sc).toMatchObject({ recipe_uid: recipe.uid, name: "Pound Cake", servings: "8", totalTime: "1 hr" });
    expect(sc.ingredients).toEqual([
      { text: "2 cups flour", group: null },
      { text: "1 cup sugar", group: null },
    ]);
    expect(sc.steps).toHaveLength(2);
    expect(sc.steps[0]).toMatchObject({ text: "Mix flour and sugar.", ingredientRefs: [0, 1] });
    // The markdown fallback leads with the recipe name.
    expect(getText(result)).toContain("# Cook: Pound Cake");
  });

  it("preserves a produces/usesIntermediate chain and renders it in the fallback", async () => {
    const recipe = makeRecipe({ name: "Pork Satay" });
    kh.seed({ recipes: [recipe] });
    const args = {
      recipe_uid: recipe.uid,
      ingredients: [
        { text: "turmeric", group: "Spice Paste" },
        { text: "lemongrass", group: "Spice Paste" },
        { text: "pork shoulder", group: "Spice Paste" },
      ],
      steps: [
        {
          text: "Pound into a paste.",
          group: "Spice Paste",
          ingredientRefs: [0, 1],
          produces: "Spice Paste",
          usesIntermediate: [],
        },
        {
          text: "Toss pork with the paste.",
          group: "Spice Paste",
          ingredientRefs: [2],
          produces: null,
          usesIntermediate: ["Spice Paste"],
        },
      ],
    };
    const result = await callCook(args);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      steps: [{ produces: "Spice Paste" }, { usesIntermediate: ["Spice Paste"] }],
    });
    const text = getText(result);
    expect(text).toContain("## Spice Paste");
    expect(text).toContain("Makes: Spice Paste");
    expect(text).toContain("Uses: Spice Paste");
  });

  it("rejects an ingredientRef out of range with a remediation hint", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });
    const args = flatArgs(recipe.uid);
    args.steps[0]!.ingredientRefs = [5]; // only 2 ingredients (indices 0–1)
    const result = await callCook(args);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain("valid indices 0–1");
  });

  it("rejects an intermediate not produced by an earlier step", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });
    const args = flatArgs(recipe.uid);
    args.steps[1]!.usesIntermediate = ["Glaze"]; // never produced
    const result = await callCook(args);
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('uses the intermediate "Glaze"');
  });

  it("rejects an intermediate referenced before it is produced (later step produces it)", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });
    const args = flatArgs(recipe.uid);
    // Step 1 uses "X", step 2 produces it — must be an EARLIER step.
    args.steps[0]!.usesIntermediate = ["X"];
    args.steps[1]!.produces = "X";
    const result = await callCook(args);
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('uses the intermediate "X"');
  });

  it("rejects duplicate produces names", async () => {
    const recipe = makeRecipe();
    kh.seed({ recipes: [recipe] });
    const args = flatArgs(recipe.uid);
    args.steps[0]!.produces = "Base";
    args.steps[1]!.produces = "Base";
    const result = await callCook(args);
    expect(result.isError).toBe(true);
    expect(getText(result)).toContain('both produce "Base"');
  });

  it("returns an isError naming read_recipe when the UID is not in the store", async () => {
    kh.seed({ recipes: [makeRecipe()] }); // seed something so the store is past cold-start
    const result = await callCook(flatArgs("nonexistent-uid"));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(getText(result)).toContain("read_recipe");
  });

  it("cold-start (empty store) returns the cold-start guard error", async () => {
    const text = getText(await callCook(flatArgs("anything")));
    expect(text.toLowerCase()).toContain("try again");
  });
});
