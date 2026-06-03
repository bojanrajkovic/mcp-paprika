import { describe, expect, it } from "vitest";

import { makeAisle } from "../cache/__fixtures__/aisles.js";
import { makeGroceryIngredient } from "../cache/__fixtures__/grocery-ingredients.js";
import { makeGroceryItem } from "../cache/__fixtures__/grocery-items.js";
import { makeGroceryList } from "../cache/__fixtures__/grocery-lists.js";
import { makeMeal, makeMealType } from "../cache/__fixtures__/meals.js";
import { makeMenu, makeMenuItem } from "../cache/__fixtures__/menus.js";
import { makePantryItem } from "../cache/__fixtures__/pantry.js";
import { makePhoto } from "../cache/__fixtures__/photos.js";
import { makeCategory, makeRecipe } from "../cache/__fixtures__/recipes.js";
import { makeAppContext } from "../support/app-context.js";
import { seed } from "./seed.js";

describe("seed", () => {
  it("routes every collection to its store", () => {
    const recipe = makeRecipe({ name: "Tacos" });
    const category = makeCategory({ name: "Mains" });
    const pantry = makePantryItem();
    const aisle = makeAisle();
    const groceryList = makeGroceryList();
    const groceryItem = makeGroceryItem();
    const groceryIngredient = makeGroceryIngredient({ name: "Cumin" });
    const meal = makeMeal();
    const mealType = makeMealType();
    const menu = makeMenu();
    const menuItem = makeMenuItem();
    const photo = makePhoto();

    const ctx = seed(makeAppContext(), {
      recipes: [recipe],
      categories: [category],
      pantry: [pantry],
      aisles: [aisle],
      groceryLists: [groceryList],
      groceryItems: [groceryItem],
      groceryIngredients: [groceryIngredient],
      meals: [meal],
      mealTypes: [mealType],
      menus: [menu],
      menuItems: [menuItem],
      photos: [photo],
    });

    expect(ctx.store.get(recipe.uid)).toEqual(recipe);
    expect(ctx.categoryStore.get(category.uid)).toEqual(category);
    expect(ctx.pantryStore.get(pantry.uid)).toEqual(pantry);
    expect(ctx.aisleStore.get(aisle.uid)).toEqual(aisle);
    expect(ctx.groceryListStore.get(groceryList.uid)).toEqual(groceryList);
    expect(ctx.groceryItemStore.get(groceryItem.uid)).toEqual(groceryItem);
    // GroceryIngredientStore is name-keyed (no get(uid)).
    expect(ctx.groceryIngredientStore.lookupByName("Cumin")).toEqual(groceryIngredient);
    expect(ctx.mealStore.get(meal.uid)).toEqual(meal);
    expect(ctx.mealTypeStore.get(mealType.uid)).toEqual(mealType);
    expect(ctx.menuStore.get(menu.uid)).toEqual(menu);
    expect(ctx.menuItemStore.get(menuItem.uid)).toEqual(menuItem);
    expect(ctx.photoStore.get(photo.uid)).toEqual(photo);
  });

  it("returns the same ctx for chaining", () => {
    const ctx = makeAppContext();
    expect(seed(ctx, { recipes: [makeRecipe()] })).toBe(ctx);
  });

  it("leaves an omitted store cold (hasSynced stays false)", () => {
    const ctx = seed(makeAppContext(), { recipes: [makeRecipe()] });

    expect(ctx.store.hasSynced).toBe(true);
    // Every store whose key was omitted is untouched.
    expect(ctx.categoryStore.hasSynced).toBe(false);
    expect(ctx.pantryStore.hasSynced).toBe(false);
    expect(ctx.mealStore.hasSynced).toBe(false);
    expect(ctx.groceryIngredientStore.hasSynced).toBe(false);
  });

  it("marks a store synced-but-empty when given an explicit empty array", () => {
    const ctx = seed(makeAppContext(), { recipes: [] });

    expect(ctx.store.hasSynced).toBe(true);
    expect(ctx.store.size).toBe(0);
  });

  it("seeds nothing on an empty payload", () => {
    const ctx = seed(makeAppContext(), {});

    expect(ctx.store.hasSynced).toBe(false);
    expect(ctx.categoryStore.hasSynced).toBe(false);
  });
});
