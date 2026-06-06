import { errAsync, okAsync } from "neverthrow";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GroceryItem } from "../grocery-item/types.js";
import type { GroceryState } from "../module.js";

import { makeGroceryItem } from "../../../../test/domains/grocery/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../../../../test/domains/grocery/__fixtures__/grocery-lists.js";
import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";

describe("add_recipe_to_grocery_list tool", () => {
  const kh = useKernelHarness<GroceryState>("grocery");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  // saveGroceryItems' ok-value is consumed (the saved items), so every happy-path
  // test must mock it to echo its input — the auto-stub returns okAsync(undefined).
  function echoSaveGroceryItems(): void {
    vi.mocked(kh.client().saveGroceryItems).mockImplementation(((items: ReadonlyArray<GroceryItem>) =>
      okAsync(items)) as never);
  }

  it("returns sync-not-ready when grocery has not synced", async () => {
    const text = await kh.callToolText("add_recipe_to_grocery_list", {
      recipe: { title: "Pad Thai" },
      items: [{ ingredient: "Rice noodles" }],
    });
    expect(text.toLowerCase()).toContain("not yet synced");
  });

  it("returns not-found for an unknown recipe UID", async () => {
    kh.seed({ recipes: [makeRecipe()], groceryLists: [makeGroceryList({ isDefault: true })], groceryItems: [] });
    const text = await kh.callToolText("add_recipe_to_grocery_list", {
      recipe: { uid: "nope" },
      items: [{ ingredient: "Rice noodles" }],
    });
    expect(text).toContain('No recipe found with UID "nope"');
  });

  it("disambiguates multiple title matches without writing", async () => {
    const a = makeRecipe({ name: "Chicken Curry" });
    const b = makeRecipe({ name: "Chicken Curry Soup" });
    kh.seed({ recipes: [a, b], groceryLists: [makeGroceryList({ isDefault: true })], groceryItems: [] });

    const text = await kh.callToolText("add_recipe_to_grocery_list", {
      recipe: { title: "Chicken" },
      items: [{ ingredient: "Chicken thighs" }],
    });

    expect(text).toContain("Multiple recipes match");
    expect(text).toContain(a.uid);
    expect(text).toContain(b.uid);
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("defaults to the isDefault list and links items by recipe name", async () => {
    echoSaveGroceryItems();
    const recipe = makeRecipe({ name: "Pad Thai" });
    const defaultList = makeGroceryList({ name: "Groceries", isDefault: true });
    const otherList = makeGroceryList({ name: "Costco" });
    kh.seed({ recipes: [recipe], groceryLists: [otherList, defaultList], groceryItems: [] });

    const text = await kh.callToolText("add_recipe_to_grocery_list", {
      recipe: { title: "Pad Thai" },
      items: [{ ingredient: "Rice noodles", quantity: "8 oz" }, { ingredient: "Tamarind paste" }],
    });

    expect(text).toContain('Added 2 item(s) from "Pad Thai" to "Groceries".');
    const saved = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]![0] as ReadonlyArray<GroceryItem>;
    expect(saved).toHaveLength(2);
    for (const item of saved) {
      expect(item.recipe).toBe("Pad Thai");
      expect(item.listUid).toBe(defaultList.uid);
    }
    // Committed to the store + Content notification fired.
    expect(kh.state().items.store.getByListUid(defaultList.uid)).toHaveLength(2);
    expect(kh.resourceListChanged()).toHaveBeenCalled();
  });

  it("reports a missing default list when listUid is omitted", async () => {
    kh.seed({ recipes: [makeRecipe({ name: "Pad Thai" })], groceryLists: [makeGroceryList()], groceryItems: [] });

    const text = await kh.callToolText("add_recipe_to_grocery_list", {
      recipe: { title: "Pad Thai" },
      items: [{ ingredient: "Rice noodles" }],
    });

    expect(text).toContain("No default grocery list found");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("skips ingredients already on the list unpurchased and reports them", async () => {
    echoSaveGroceryItems();
    const recipe = makeRecipe({ name: "Pad Thai" });
    const list = makeGroceryList({ name: "Groceries", isDefault: true });
    const existing = makeGroceryItem({ listUid: list.uid, ingredient: "rice noodles", purchased: false });
    kh.seed({ recipes: [recipe], groceryLists: [list], groceryItems: [existing] });

    const text = await kh.callToolText("add_recipe_to_grocery_list", {
      recipe: { title: "Pad Thai" },
      items: [{ ingredient: "Rice Noodles" }, { ingredient: "Tamarind paste" }],
    });

    expect(text).toContain('Added 1 item(s) from "Pad Thai"');
    expect(text).toContain("Already on the list (skipped): Rice Noodles.");
    const saved = vi.mocked(kh.client().saveGroceryItems).mock.calls[0]![0] as ReadonlyArray<GroceryItem>;
    expect(saved).toHaveLength(1);
    expect(saved[0]!.ingredient).toBe("Tamarind paste");
  });

  it("does not skip over a purchased copy of the same ingredient", async () => {
    echoSaveGroceryItems();
    const recipe = makeRecipe({ name: "Pad Thai" });
    const list = makeGroceryList({ name: "Groceries", isDefault: true });
    const bought = makeGroceryItem({ listUid: list.uid, ingredient: "Rice noodles", purchased: true });
    kh.seed({ recipes: [recipe], groceryLists: [list], groceryItems: [bought] });

    const text = await kh.callToolText("add_recipe_to_grocery_list", {
      recipe: { title: "Pad Thai" },
      items: [{ ingredient: "Rice noodles" }],
    });

    expect(text).toContain('Added 1 item(s) from "Pad Thai"');
  });

  it("returns nothing-to-add when every ingredient is already on the list", async () => {
    const recipe = makeRecipe({ name: "Pad Thai" });
    const list = makeGroceryList({ name: "Groceries", isDefault: true });
    const existing = makeGroceryItem({ listUid: list.uid, ingredient: "Rice noodles", purchased: false });
    kh.seed({ recipes: [recipe], groceryLists: [list], groceryItems: [existing] });

    const text = await kh.callToolText("add_recipe_to_grocery_list", {
      recipe: { title: "Pad Thai" },
      items: [{ ingredient: "Rice noodles" }],
    });

    expect(text).toContain("Nothing to add");
    expect(kh.client().saveGroceryItems).not.toHaveBeenCalled();
  });

  it("surfaces a save failure", async () => {
    const recipe = makeRecipe({ name: "Pad Thai" });
    const list = makeGroceryList({ isDefault: true });
    kh.seed({ recipes: [recipe], groceryLists: [list], groceryItems: [] });
    vi.mocked(kh.client().saveGroceryItems).mockReturnValue(errAsync(new Error("Network error")) as never);

    const text = await kh.callToolText("add_recipe_to_grocery_list", {
      recipe: { title: "Pad Thai" },
      items: [{ ingredient: "Rice noodles" }],
    });

    expect(text).toContain("Failed to add grocery items");
    expect(text).toContain("Network error");
  });
});
