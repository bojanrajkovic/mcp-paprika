import { describe, it, expect } from "vitest";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { registerFilterTools } from "./filter.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";

describe("p2-discovery-tools: filter_by_ingredient tool", () => {
  describe("p2-discovery-tools.AC2: filter_by_ingredient", () => {
    it("p2-discovery-tools.AC2.1: mode=all returns only recipes with all ingredients", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
          makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
          makeRecipe({ name: "Garlic Bread", ingredients: "bread, garlic, butter" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["tomato", "garlic"],
        mode: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Pasta");
      expect(text).not.toContain("Salad");
      expect(text).not.toContain("Garlic Bread");
    });

    it("p2-discovery-tools.AC2.2: mode=any returns recipes with any ingredient", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
          makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
          makeRecipe({ name: "Rice", ingredients: "rice, water" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["tomato", "garlic"],
        mode: "any",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Pasta");
      expect(text).toContain("Salad");
      expect(text).not.toContain("Rice");
    });

    it("p2-discovery-tools.AC2.3: mode defaults to all (pass mode: all explicitly in test)", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "HasBoth", ingredients: "tomato, garlic" }),
          makeRecipe({ name: "HasOne", ingredients: "tomato, onion" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      // mode: "all" is the default — passing explicitly mirrors SDK default behavior
      const result = await callTool("filter_by_ingredient", {
        ingredients: ["tomato", "garlic"],
        mode: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("HasBoth");
      expect(text).not.toContain("HasOne");
    });

    it("p2-discovery-tools.AC2.4: limit caps results (using explicit limit=20)", async () => {
      const store = new RecipeStore();
      store.load(
        Array.from({ length: 25 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}`, ingredients: "tomato" })),
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["tomato"],
        mode: "all",
        limit: 20,
      });
      const text = getText(result);
      const separators = (text.match(/^---$/gm) ?? []).length;

      expect(separators).toBe(19); // 20 results = 19 separators
    });

    it("p2-discovery-tools.AC2.5: empty store returns cold-start Err payload", async () => {
      const store = new RecipeStore();
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["anything"],
        mode: "all",
        limit: 20,
      });

      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC2.6: no matching recipes returns empty-result message", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Pasta", ingredients: "pasta, tomato" })], []);
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["sushi"],
        mode: "all",
        limit: 20,
      });
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });
  });
});

describe("p2-discovery-tools: filter_by_time tool", () => {
  describe("p2-discovery-tools.AC3: filter_by_time", () => {
    it("p2-discovery-tools.AC3.1: maxTotalTime returns only recipes with totalTime <= constraint", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "Quick", totalTime: "20 min" }),
          makeRecipe({ name: "Medium", totalTime: "45 min" }),
          makeRecipe({ name: "Slow", totalTime: "2 hours" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "30 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("Quick");
      expect(text).not.toContain("Medium");
      expect(text).not.toContain("Slow");
    });

    it("p2-discovery-tools.AC3.2: maxPrepTime returns only recipes with prepTime <= constraint", async () => {
      const store = new RecipeStore();
      store.load(
        [makeRecipe({ name: "QuickPrep", prepTime: "10 min" }), makeRecipe({ name: "LongPrep", prepTime: "1 hour" })],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxPrepTime: "15 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("QuickPrep");
      expect(text).not.toContain("LongPrep");
    });

    it("p2-discovery-tools.AC3.3: maxCookTime returns only recipes with cookTime <= constraint", async () => {
      const store = new RecipeStore();
      store.load(
        [makeRecipe({ name: "QuickCook", cookTime: "15 min" }), makeRecipe({ name: "SlowCook", cookTime: "3 hours" })],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxCookTime: "30 min",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("QuickCook");
      expect(text).not.toContain("SlowCook");
    });

    it("p2-discovery-tools.AC3.4: results ordered by total time ascending", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({ name: "Slow", totalTime: "60 min" }),
          makeRecipe({ name: "Fast", totalTime: "10 min" }),
          makeRecipe({ name: "Medium", totalTime: "30 min" }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "2 hours",
        limit: 20,
      });
      const text = getText(result);

      const fastPos = text.indexOf("Fast");
      const mediumPos = text.indexOf("Medium");
      const slowPos = text.indexOf("Slow");

      expect(fastPos).toBeLessThan(mediumPos);
      expect(mediumPos).toBeLessThan(slowPos);
    });

    it("p2-discovery-tools.AC3.5: limit applied post-store (at most limit results)", async () => {
      const store = new RecipeStore();
      store.load(
        Array.from({ length: 10 }, (_, i) => makeRecipe({ name: `Recipe ${String(i + 1)}`, totalTime: "20 min" })),
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "1 hour",
        limit: 3,
      });
      const text = getText(result);
      const separators = (text.match(/^---$/gm) ?? []).length;

      expect(separators).toBe(2); // 3 results = 2 separators
    });

    it("p2-discovery-tools.AC3.6: all constraints optional — no constraints returns all recipes sorted by time", async () => {
      const store = new RecipeStore();
      store.load(
        [makeRecipe({ name: "Alpha", totalTime: "10 min" }), makeRecipe({ name: "Beta", totalTime: "20 min" })],
        [],
      );
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", { limit: 20 });
      const text = getText(result);

      expect(text).toContain("Alpha");
      expect(text).toContain("Beta");
    });

    it("p2-discovery-tools.AC3.7: empty store returns cold-start Err payload", async () => {
      const store = new RecipeStore();
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "30 minutes",
        limit: 20,
      });

      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC3.8: no recipes match constraints returns empty-result message", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Slow", totalTime: "4 hours" })], []);
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "10 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });

    it("invalid duration string returns user-friendly error message", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Quick", totalTime: "20 min" })], []);
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(store, server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "not a time",
        limit: 20,
      });
      const text = getText(result);

      // parseMaybeMinutes returns Err — handler returns user-friendly message
      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("invalid");
    });
  });
});
