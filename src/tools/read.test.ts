import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerReadTool } from "./read.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";

describe("p2-recipe-crud: read_recipe tool", () => {
  describe("p2-recipe-crud.AC1: read_recipe", () => {
    it("p2-recipe-crud.AC1.1: UID lookup returns recipe as markdown with heading", async () => {
      const recipe = makeRecipe({ name: "Chocolate Cake" });
      const store = new RecipeStore();
      store.load([recipe], []);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", { uid: recipe.uid });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
    });

    it("p2-recipe-crud.AC1.1 (extended): UID lookup includes category names", async () => {
      const category = makeCategory({ name: "Dessert" });
      const recipe = makeRecipe({ name: "Chocolate Cake", categories: [category.uid] });
      const store = new RecipeStore();
      store.load([recipe], [category]);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", { uid: recipe.uid });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
      expect(text).toContain("Dessert");
    });

    it("p2-recipe-crud.AC1.2: exact title match returns recipe markdown", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Chocolate Cake" })], []);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", { title: "Chocolate Cake" });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
    });

    it("p2-recipe-crud.AC1.3: starts-with title match returns recipe markdown", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Chocolate Cake" })], []);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", { title: "Choco" });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
    });

    it("p2-recipe-crud.AC1.3 (extended): contains title match returns recipe markdown", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Chocolate Cake" })], []);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", { title: "late Ca" });
      const text = getText(result);

      expect(text).toContain("# Chocolate Cake");
    });

    it("p2-recipe-crud.AC1.4: multiple title matches return disambiguation list", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta Bolognese" }), makeRecipe({ name: "Pasta Carbonara" })], []);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", { title: "Pasta" });
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
      const store = new RecipeStore();
      store.load([makeRecipe()], []);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", { uid: "nonexistent-uid" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("found");
    });

    it("p2-recipe-crud.AC1.6: title search with no matches returns not-found message", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta" })], []);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", { title: "Zyzzyva Surprise" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("found");
    });

    it("p2-recipe-crud.AC1.7: neither uid nor title provided returns error message", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", {});
      const text = getText(result);

      expect(text.toLowerCase()).toContain("provide either");
    });

    it("p2-recipe-crud.AC1.8: cold-start (empty store) returns cold-start guard error", async () => {
      const store = new RecipeStore(); // not loaded — size === 0
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      const result = await callTool("read_recipe", { uid: "anything" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
    });

    it("p2-recipe-crud.AC1.9: uid takes precedence over title", async () => {
      const recipe1 = makeRecipe({ name: "First Recipe" });
      const recipe2 = makeRecipe({ name: "First" });
      const store = new RecipeStore();
      store.load([recipe1, recipe2], []);
      const { server, callTool } = makeTestServer();
      registerReadTool(server, makeCtx(store, server));

      // Call with recipe1's uid and recipe2's name
      const result = await callTool("read_recipe", {
        uid: recipe1.uid,
        title: recipe2.name,
      });
      const text = getText(result);

      // Should return recipe1's content (UID wins)
      expect(text).toContain("# First Recipe");
      expect(text).not.toContain("# First\n"); // Avoid matching "First Recipe" as partial
    });
  });
});
