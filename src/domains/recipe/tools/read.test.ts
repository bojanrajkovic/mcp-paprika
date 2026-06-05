import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("read_recipe tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("UID lookup returns recipe as markdown with heading", async () => {
    const recipe = makeRecipe({ name: "Chocolate Cake" });
    kh.seed({ recipes: [recipe] });
    const text = await kh.callToolText("read_recipe", { lookup: { uid: recipe.uid } });
    expect(text).toContain("# Chocolate Cake");
    // The UID is rendered so the caller can act on the recipe without a re-lookup.
    expect(text).toContain(recipe.uid);
  });

  it("UID lookup includes category names", async () => {
    const category = makeCategory({ name: "Dessert" });
    const recipe = makeRecipe({ name: "Chocolate Cake", categories: [category.uid] });
    kh.seed({ recipes: [recipe], categories: [category] });
    const text = await kh.callToolText("read_recipe", { lookup: { uid: recipe.uid } });
    expect(text).toContain("# Chocolate Cake");
    expect(text).toContain("Dessert");
  });

  it("exact title match returns recipe markdown", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake" })] });
    const text = await kh.callToolText("read_recipe", { lookup: { title: "Chocolate Cake" } });
    expect(text).toContain("# Chocolate Cake");
  });

  it("starts-with title match returns recipe markdown", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake" })] });
    const text = await kh.callToolText("read_recipe", { lookup: { title: "Choco" } });
    expect(text).toContain("# Chocolate Cake");
  });

  it("contains title match returns recipe markdown", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake" })] });
    const text = await kh.callToolText("read_recipe", { lookup: { title: "late Ca" } });
    expect(text).toContain("# Chocolate Cake");
  });

  it("multiple title matches return a disambiguation list", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta Bolognese" }), makeRecipe({ name: "Pasta Carbonara" })] });
    const text = await kh.callToolText("read_recipe", { lookup: { title: "Pasta" } });
    expect(text).toContain("Pasta Bolognese");
    expect(text).toContain("Pasta Carbonara");
    expect(text).toContain("UID:");
    // A list, not a full recipe render.
    expect(text).not.toContain("## Ingredients");
  });

  it("UID not found returns a not-found message", async () => {
    kh.seed({ recipes: [makeRecipe()] });
    const text = await kh.callToolText("read_recipe", { lookup: { uid: "nonexistent-uid" } });
    expect(text.toLowerCase()).toContain("found");
  });

  it("title search with no matches returns a not-found message", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta" })] });
    const text = await kh.callToolText("read_recipe", { lookup: { title: "Zyzzyva Surprise" } });
    expect(text.toLowerCase()).toContain("found");
  });

  it("cold-start (empty store) returns the cold-start guard error", async () => {
    // store never seeded — size === 0, hasSynced false
    const text = await kh.callToolText("read_recipe", { lookup: { uid: "anything" } });
    expect(text.toLowerCase()).toContain("try again");
  });
});
