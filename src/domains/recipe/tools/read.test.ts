import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { makeCategory, makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

describe("read_recipe tool", () => {
  const kh = useKernelHarness("recipe");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  it("UID lookup returns the recipe payload as JSON text carrying the UID", async () => {
    const recipe = makeRecipe({ name: "Chocolate Cake" });
    kh.seed({ recipes: [recipe] });
    const text = await kh.callToolText("read_recipe", { lookup: { uid: recipe.uid } });
    // The text is now the structured payload as compact JSON — the UID rides it, so the
    // model can chain read_recipe → cook_recipe on a host that only forwards text.
    const parsed = JSON.parse(text) as { uid: string; name: string };
    expect(parsed.uid).toBe(recipe.uid);
    expect(parsed.name).toBe("Chocolate Cake");
  });

  it("UID lookup includes category names", async () => {
    const category = makeCategory({ name: "Dessert" });
    const recipe = makeRecipe({ name: "Chocolate Cake", categories: [category.uid] });
    kh.seed({ recipes: [recipe], categories: [category] });
    const text = await kh.callToolText("read_recipe", { lookup: { uid: recipe.uid } });
    const parsed = JSON.parse(text) as { name: string; categories: Array<string> };
    expect(parsed.name).toBe("Chocolate Cake");
    expect(parsed.categories).toContain("Dessert");
  });

  it("exact title match returns the recipe", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake" })] });
    const text = await kh.callToolText("read_recipe", { lookup: { title: "Chocolate Cake" } });
    expect((JSON.parse(text) as { name: string }).name).toBe("Chocolate Cake");
  });

  it("starts-with title match returns the recipe", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake" })] });
    const text = await kh.callToolText("read_recipe", { lookup: { title: "Choco" } });
    expect((JSON.parse(text) as { name: string }).name).toBe("Chocolate Cake");
  });

  it("contains title match returns the recipe", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Chocolate Cake" })] });
    const text = await kh.callToolText("read_recipe", { lookup: { title: "late Ca" } });
    expect((JSON.parse(text) as { name: string }).name).toBe("Chocolate Cake");
  });

  it("multiple title matches return an isError disambiguation list", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta Bolognese" }), makeRecipe({ name: "Pasta Carbonara" })] });
    const result = await kh.callTool("read_recipe", { lookup: { title: "Pasta" } });
    expect(result.isError).toBe(true);
    const text = getText(result);
    expect(text).toContain("Pasta Bolognese");
    expect(text).toContain("Pasta Carbonara");
    expect(text).toContain("(uid:");
    // A list, not a full recipe render.
    expect(text).not.toContain("## Ingredients");
  });

  it("UID not found returns an isError not-found message naming search_recipes", async () => {
    kh.seed({ recipes: [makeRecipe()] });
    const result = await kh.callTool("read_recipe", { lookup: { uid: "nonexistent-uid" } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe(
      'No recipe found with UID "nonexistent-uid" (it may not exist or was already deleted). Use search_recipes to find it.',
    );
  });

  it("title search with no matches returns an isError not-found message naming search_recipes", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pasta" })] });
    const result = await kh.callTool("read_recipe", { lookup: { title: "Zyzzyva Surprise" } });
    expect(result.isError).toBe(true);
    expect(getText(result)).toBe('No recipes found matching "Zyzzyva Surprise". Use search_recipes to find it.');
  });

  it("cold-start (empty store) returns the cold-start guard error", async () => {
    // store never seeded — size === 0, hasSynced false
    const text = await kh.callToolText("read_recipe", { lookup: { uid: "anything" } });
    expect(text.toLowerCase()).toContain("try again");
  });

  it("carries structuredContent with the recipe's machine fields (B1/#321)", async () => {
    const category = makeCategory({ name: "Dessert" });
    const recipe = makeRecipe({
      name: "Chocolate Cake",
      categories: [category.uid],
      ingredients: "flour, sugar",
      directions: "mix, bake",
    });
    kh.seed({ recipes: [recipe], categories: [category] });
    const result = await kh.callTool("read_recipe", { lookup: { uid: recipe.uid } });
    expect(result.isError).toBeUndefined();
    // categoryUids is the raw FK; categories is the resolved-name view (raw+resolved split);
    // the body rides structured for the cooking widget (#337).
    expect(result.structuredContent).toMatchObject({
      uid: recipe.uid,
      name: "Chocolate Cake",
      categoryUids: [category.uid],
      categories: ["Dessert"],
      ingredients: "flour, sugar",
      directions: "mix, bake",
    });
  });

  it("a not-found result carries no structuredContent (errorResult, B1/#321)", async () => {
    kh.seed({ recipes: [makeRecipe()] });
    const result = await kh.callTool("read_recipe", { lookup: { uid: "nonexistent-uid" } });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("structured photoUrl coalesces the imported image_url when no Paprika photo is set (B1/#321)", async () => {
    // Imported/web recipes commonly carry imageUrl with photoUrl still null; a card
    // rendering from photoUrl alone would drop the photo (matches recipe-resource.ts).
    const recipe = makeRecipe({ name: "Imported", imageUrl: "https://site/hero.jpg", photoUrl: null });
    kh.seed({ recipes: [recipe] });
    const result = await kh.callTool("read_recipe", { lookup: { uid: recipe.uid } });
    expect((result.structuredContent as { photoUrl: string | null }).photoUrl).toBe("https://site/hero.jpg");
  });
});
