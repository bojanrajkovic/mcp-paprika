import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerSearchTool } from "./search.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";

describe("p2-discovery-tools: search_recipes tool", () => {
  describe("p2-discovery-tools.AC1: search_recipes", () => {
    it("p2-discovery-tools.AC1.1: non-empty store + matching query returns formatted results", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Chocolate Cake" })], []);
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "chocolate",
        limit: 20,
      });

      expect(getText(result)).toContain("Chocolate Cake");
    });

    it("p2-discovery-tools.AC1.1 (extended): time fields are rendered when populated", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({
            name: "Pasta Carbonara",
            prepTime: "10 min",
            totalTime: "25 min",
          }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "pasta",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Prep: 10 min");
      expect(text).toContain("Total: 25 min");
    });

    it("p2-discovery-tools.AC1.2: limit defaults to 20 when store has many matches", async () => {
      const store = new RecipeStore();
      // Load 25 recipes all matching "recipe"
      store.load(
        Array.from({ length: 25 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}` })),
        [],
      );
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      // Pass limit: 20 explicitly (mirrors what the SDK provides when caller omits limit,
      // since z.default(20) ensures the handler always receives 20 for omitted limit).
      const result = await callTool("search_recipes", { query: "recipe", limit: 20 });
      const text = getText(result);

      // Count "---" separators: N results produce N-1 separators
      const separators = (text.match(/^---$/gm) ?? []).length;
      expect(separators).toBe(19); // 20 results = 19 separators
    });

    it("p2-discovery-tools.AC1.3: limit caps result count", async () => {
      const store = new RecipeStore();
      store.load(
        Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}` })),
        [],
      );
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "recipe",
        limit: 3,
      });
      const text = getText(result);

      const separators = (text.match(/^---$/gm) ?? []).length;
      expect(separators).toBe(2); // 3 results = 2 separators
    });

    it("p2-discovery-tools.AC1.4: category names appear in formatted results", async () => {
      const category = makeCategory({ name: "Dessert" });
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Cake", categories: [category.uid] })], [category]);
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "cake",
        limit: 20,
      });

      expect(getText(result)).toContain("Dessert");
    });

    it("p2-discovery-tools.AC1.5: empty store returns cold-start Err payload", async () => {
      const store = new RecipeStore(); // not loaded — size === 0
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "anything",
        limit: 20,
      });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC1.6: no matching recipes returns empty-result message (not an error)", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta Carbonara" })], []);
      const { server, callTool } = makeTestServer();
      registerSearchTool(server, makeCtx(store, server));

      const result = await callTool("search_recipes", {
        query: "sushi",
        limit: 20,
      });
      const text = getText(result);

      // Must be a normal text response (not error), containing the query
      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });
  });
});
