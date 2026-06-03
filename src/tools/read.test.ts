import { describe, expect, it } from "vitest";

import { makeMeal } from "../../test/cache/__fixtures__/meals.js";
import { makeCategory, makeRecipe } from "../../test/cache/__fixtures__/recipes.js";
import { getText, makeCtx, makeTestServer, seed } from "../../test/support/tool-test-utils.js";
import { RecipeStore } from "../recipe/store.js";
import { registerReadTool } from "./read.js";

describe("p2-recipe-crud: read_recipe tool", () => {
  describe("p2-recipe-crud.AC1: read_recipe", () => {
    it("p2-recipe-crud.AC1.1: UID lookup returns recipe as markdown with heading", async () => {
      const recipe = makeRecipe({ name: "Chocolate Cake" });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), { recipes: [recipe] });
      registerReadTool(server, ctx);

      const result = await callTool("read_recipe", { lookup: { uid: recipe.uid } });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
      // The UID is rendered so the caller can act on the recipe without a re-lookup.
      expect(text).toContain(recipe.uid);
    });

    it("p2-recipe-crud.AC1.1 (extended): UID lookup includes category names", async () => {
      const category = makeCategory({ name: "Dessert" });
      const recipe = makeRecipe({ name: "Chocolate Cake", categories: [category.uid] });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [recipe],
        categories: [category],
      });
      registerReadTool(server, ctx);

      const result = await callTool("read_recipe", { lookup: { uid: recipe.uid } });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
      expect(text).toContain("Dessert");
    });

    it("p2-recipe-crud.AC1.2: exact title match returns recipe markdown", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Chocolate Cake" })],
      });
      registerReadTool(server, ctx);

      const result = await callTool("read_recipe", { lookup: { title: "Chocolate Cake" } });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
    });

    it("p2-recipe-crud.AC1.3: starts-with title match returns recipe markdown", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Chocolate Cake" })],
      });
      registerReadTool(server, ctx);

      const result = await callTool("read_recipe", { lookup: { title: "Choco" } });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
    });

    it("p2-recipe-crud.AC1.3 (extended): contains title match returns recipe markdown", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Chocolate Cake" })],
      });
      registerReadTool(server, ctx);

      const result = await callTool("read_recipe", { lookup: { title: "late Ca" } });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
    });

    it("p2-recipe-crud.AC1.4: multiple title matches return disambiguation list", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Pasta Bolognese" }), makeRecipe({ name: "Pasta Carbonara" })],
      });
      registerReadTool(server, ctx);

      const result = await callTool("read_recipe", { lookup: { title: "Pasta" } });
      const text = getText(result);

      // Must contain both names
      expect(text).toContain("Pasta Bolognese");
      expect(text).toContain("Pasta Carbonara");
      // Must contain UIDs
      expect(text).toContain("UID:");
      // Must NOT contain recipe section (it's a list, not full recipe)
      expect(text).not.toContain("## Ingredients");
    });

    it("p2-recipe-crud.AC1.5: UID not found returns not-found message", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe()] });
      registerReadTool(server, ctx);

      const result = await callTool("read_recipe", { lookup: { uid: "nonexistent-uid" } });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("found");
    });

    it("p2-recipe-crud.AC1.6: title search with no matches returns not-found message", async () => {
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ name: "Pasta" })],
      });
      registerReadTool(server, ctx);

      const result = await callTool("read_recipe", { lookup: { title: "Zyzzyva Surprise" } });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("found");
    });

    it("p2-recipe-crud.AC1.8: cold-start (empty store) returns cold-start guard error", async () => {
      // store not loaded — size === 0
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(new RecipeStore(), server));

      const result = await callTool("read_recipe", { lookup: { uid: "anything" } });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
    });
  });

  describe("lastCookedAt enrichment", () => {
    it("includes Last Cooked when meal history exists for the recipe", async () => {
      const recipe = makeRecipe({ name: "Pasta" });
      const { server, callTool } = makeTestServer();
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [recipe],
        meals: [makeMeal({ recipeUid: recipe.uid, date: "2026-03-15 00:00:00" })],
      });
      registerReadTool(server, ctx);

      const result = await callTool("read_recipe", { lookup: { uid: recipe.uid } });
      expect(getText(result)).toContain("**Last Cooked:** 2026-03-15");
    });
  });
});
