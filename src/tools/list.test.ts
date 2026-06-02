import { describe, it, expect } from "vitest";
import { RecipeStore } from "../recipe/store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { makeMeal } from "../cache/__fixtures__/meals.js";
import { registerListTool } from "./list.js";
import { makeTestServer, makeCtx, getText, seed } from "./tool-test-utils.js";

describe("p2-discovery-tools: list_recipes tool", () => {
  describe("p2-discovery-tools.AC2: list_recipes", () => {
    it("p2-discovery-tools.AC2.1: returns recipe names sorted alphabetically", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Zucchini Soup" }), makeRecipe({ name: "Apple Crumble" })],
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      const text = getText(result);

      const applePos = text.indexOf("Apple Crumble");
      const zucchiniPos = text.indexOf("Zucchini Soup");
      expect(applePos).toBeLessThan(zucchiniPos);
    });

    it("p2-discovery-tools.AC2.2: created date appears in each list entry", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Pasta", created: "2025-06-01T00:00:00Z" })],
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      const text = getText(result);

      expect(text).toContain("2025-06-01");
    });

    it("p2-discovery-tools.AC2.3-pos: rating appears in list entry when > 0", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Pasta", rating: 3 })],
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      const text = getText(result);

      expect(text).toContain("3/5");
    });

    it("p2-discovery-tools.AC2.3-neg: rating omitted from list entry when 0", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Pasta", rating: 0 })],
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      const text = getText(result);

      expect(text).not.toContain("/5");
    });

    it("p2-discovery-tools.AC2.4-pos: pinned marker appears when isPinned is true", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Pasta", isPinned: true })],
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).toContain("pinned");
    });

    it("p2-discovery-tools.AC2.4-neg: pinned marker absent when isPinned is false", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Pasta", isPinned: false })],
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).not.toContain("pinned");
    });

    it("p2-discovery-tools.AC2.5-pos: on-grocery-list marker appears when onGroceryList is true", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Pasta", onGroceryList: true })],
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).toContain("grocery list");
    });

    it("p2-discovery-tools.AC2.5-neg: on-grocery-list marker absent when onGroceryList is false", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Pasta", onGroceryList: false })],
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).not.toContain("grocery list");
    });

    it("p2-discovery-tools.AC2.6: empty store returns cold-start message", async () => {
      // store not loaded — size === 0
      const { server, callTool } = makeTestServer();
      registerListTool(server, makeCtx(new RecipeStore(), server));

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC2.7: pagination offset and limit are respected", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1).padStart(2, "0")}` })),
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 5, limit: 3 });
      const text = getText(result);

      expect(text).toContain("Showing 3 of 10");
    });
  });

  describe("lastCookedAt enrichment", () => {
    it("includes last cooked metadata when meal history exists", async () => {
      const recipe = makeRecipe({ name: "Pasta" });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [recipe],
        meals: [makeMeal({ recipeUid: recipe.uid, date: "2026-04-10 00:00:00" })],
      });
      registerListTool(server, ctx);

      const result = await callTool("list_recipes", { offset: 0, limit: 25 });
      expect(getText(result)).toContain("last cooked: 2026-04-10");
    });
  });
});
