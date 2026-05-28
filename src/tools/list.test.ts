import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { MealStore } from "../cache/meal-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { makeMeal } from "../cache/__fixtures__/meals.js";
import { registerListTool } from "./list.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";

describe("p2-discovery-tools: list_recipes tool", () => {
  describe("p2-discovery-tools.AC2: list_recipes", () => {
    it("p2-discovery-tools.AC2.1: returns recipe names sorted alphabetically", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Zucchini Soup" }), makeRecipe({ name: "Apple Crumble" })], []);
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      const text = getText(result);

      const applePos = text.indexOf("Apple Crumble");
      const zucchiniPos = text.indexOf("Zucchini Soup");
      expect(applePos).toBeLessThan(zucchiniPos);
    });

    it("p2-discovery-tools.AC2.2: created date appears in each list entry", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta", created: "2025-06-01T00:00:00Z" })], []);
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      const text = getText(result);

      expect(text).toContain("2025-06-01");
    });

    it("p2-discovery-tools.AC2.3-pos: rating appears in list entry when > 0", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta", rating: 3 })], []);
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      const text = getText(result);

      expect(text).toContain("3/5");
    });

    it("p2-discovery-tools.AC2.3-neg: rating omitted from list entry when 0", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta", rating: 0 })], []);
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      const text = getText(result);

      expect(text).not.toContain("/5");
    });

    it("p2-discovery-tools.AC2.4-pos: pinned marker appears when isPinned is true", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta", isPinned: true })], []);
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).toContain("pinned");
    });

    it("p2-discovery-tools.AC2.4-neg: pinned marker absent when isPinned is false", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta", isPinned: false })], []);
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).not.toContain("pinned");
    });

    it("p2-discovery-tools.AC2.5-pos: on-grocery-list marker appears when onGroceryList is true", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta", onGroceryList: true })], []);
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).toContain("grocery list");
    });

    it("p2-discovery-tools.AC2.5-neg: on-grocery-list marker absent when onGroceryList is false", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta", onGroceryList: false })], []);
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).not.toContain("grocery list");
    });

    it("p2-discovery-tools.AC2.6: empty store returns cold-start message", async () => {
      const store = new RecipeStore();
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC2.7: pagination offset and limit are respected", async () => {
      const store = new RecipeStore();
      store.load(
        Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1).padStart(2, "0")}` })),
        [],
      );
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server));

      const result = await callTool("list_recipes", { offset: 5, limit: 3 });
      const text = getText(result);

      expect(text).toContain("Showing 3 of 10");
    });
  });

  describe("lastCookedAt enrichment", () => {
    it("includes last cooked metadata when meal history exists", async () => {
      const recipe = makeRecipe({ name: "Pasta" });
      const store = new RecipeStore();
      store.load([recipe], []);
      const mealStore = new MealStore();
      mealStore.load([makeMeal({ recipeUid: recipe.uid, date: "2026-04-10 00:00:00" })]);
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(store, server, { mealStore }));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).toContain("last cooked: 2026-04-10");
    });
  });
});
