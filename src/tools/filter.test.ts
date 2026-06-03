import { describe, expect, it } from "vitest";

import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { RecipeStore } from "../recipe/store.js";
import { registerFilterTools } from "./filter.js";
import { getText, makeCtx, makeTestServer, seed } from "./tool-test-utils.js";

describe("p2-discovery-tools: filter_by_ingredient tool", () => {
  describe("p2-discovery-tools.AC2: filter_by_ingredient", () => {
    it("p2-discovery-tools.AC2.1: mode=all returns only recipes with all ingredients", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
            makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
            makeRecipe({ name: "Garlic Bread", ingredients: "bread, garlic, butter" }),
          ],
        }),
      );

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
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Pasta", ingredients: "pasta, tomato, garlic" }),
            makeRecipe({ name: "Salad", ingredients: "lettuce, tomato" }),
            makeRecipe({ name: "Rice", ingredients: "rice, water" }),
          ],
        }),
      );

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
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "HasBoth", ingredients: "tomato, garlic" }),
            makeRecipe({ name: "HasOne", ingredients: "tomato, onion" }),
          ],
        }),
      );

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
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: Array.from({ length: 25 }, (_, i) =>
            makeRecipe({ name: `Recipe ${String(i + 1)}`, ingredients: "tomato" }),
          ),
        }),
      );

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
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(new RecipeStore(), server));

      const result = await callTool("filter_by_ingredient", {
        ingredients: ["anything"],
        mode: "all",
        limit: 20,
      });

      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC2.6: no matching recipes returns empty-result message", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ name: "Pasta", ingredients: "pasta, tomato" })],
        }),
      );

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
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Quick", totalTime: "20 min" }),
            makeRecipe({ name: "Medium", totalTime: "45 min" }),
            makeRecipe({ name: "Slow", totalTime: "2 hours" }),
          ],
        }),
      );

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
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "QuickPrep", prepTime: "10 min" }),
            makeRecipe({ name: "LongPrep", prepTime: "1 hour" }),
          ],
        }),
      );

      const result = await callTool("filter_by_time", {
        maxPrepTime: "15 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("QuickPrep");
      expect(text).not.toContain("LongPrep");
    });

    it("p2-discovery-tools.AC3.3: maxCookTime returns only recipes with cookTime <= constraint", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "QuickCook", cookTime: "15 min" }),
            makeRecipe({ name: "SlowCook", cookTime: "3 hours" }),
          ],
        }),
      );

      const result = await callTool("filter_by_time", {
        maxCookTime: "30 min",
        limit: 20,
      });
      const text = getText(result);

      expect(text).toContain("QuickCook");
      expect(text).not.toContain("SlowCook");
    });

    it("p2-discovery-tools.AC3.4: results ordered by total time ascending", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Slow", totalTime: "60 min" }),
            makeRecipe({ name: "Fast", totalTime: "10 min" }),
            makeRecipe({ name: "Medium", totalTime: "30 min" }),
          ],
        }),
      );

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
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: Array.from({ length: 10 }, (_, i) =>
            makeRecipe({ name: `Recipe ${String(i + 1)}`, totalTime: "20 min" }),
          ),
        }),
      );

      const result = await callTool("filter_by_time", {
        maxTotalTime: "1 hour",
        limit: 3,
      });
      const text = getText(result);
      const separators = (text.match(/^---$/gm) ?? []).length;

      expect(separators).toBe(2); // 3 results = 2 separators
    });

    it("p2-discovery-tools.AC3.6: all constraints optional — no constraints returns all recipes sorted by time", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "Alpha", totalTime: "10 min" }),
            makeRecipe({ name: "Beta", totalTime: "20 min" }),
          ],
        }),
      );

      const result = await callTool("filter_by_time", { limit: 20 });
      const text = getText(result);

      expect(text).toContain("Alpha");
      expect(text).toContain("Beta");
    });

    it("p2-discovery-tools.AC3.7: empty store returns cold-start Err payload", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(server, makeCtx(new RecipeStore(), server));

      const result = await callTool("filter_by_time", {
        maxTotalTime: "30 minutes",
        limit: 20,
      });

      expect(getText(result).toLowerCase()).toContain("try again");
    });

    it("p2-discovery-tools.AC3.8: no recipes match constraints returns empty-result message", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Slow", totalTime: "4 hours" })] }),
      );

      const result = await callTool("filter_by_time", {
        maxTotalTime: "10 minutes",
        limit: 20,
      });
      const text = getText(result);

      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("no recipes");
    });

    it("invalid duration string returns user-friendly error message", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Quick", totalTime: "20 min" })] }),
      );

      const result = await callTool("filter_by_time", {
        maxTotalTime: "not a time",
        limit: 20,
      });
      const text = getText(result);

      // parseMaybeMinutes returns Err — handler returns user-friendly message
      expect(result.isError).toBeFalsy();
      expect(text.toLowerCase()).toContain("invalid");
    });

    it("p2-discovery-tools.AC3.9: a genuinely-unparseable-time recipe is kept but flagged 'Time unverified' (#162, advisory)", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "CleanRecipe", totalTime: "20 min" }),
            makeRecipe({ name: "VagueRecipe", totalTime: "overnight" }),
          ],
        }),
      );

      const result = await callTool("filter_by_time", { maxTotalTime: "30 minutes", limit: 20 });
      const text = getText(result);

      // Lenient inclusion preserved (AC5.5): both are returned, the unparseable one not hidden.
      expect(text).toContain("CleanRecipe");
      expect(text).toContain("VagueRecipe");
      // But only the unparseable one carries the advisory flag.
      expect(text).toContain("Time unverified");
      expect(text).toContain("total time");
      expect((text.match(/Time unverified/g) ?? []).length).toBe(1);
    });

    it("p2-discovery-tools.AC3.10: recipes whose times all parse carry no advisory flag", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "AllClean", totalTime: "20 min" })] }),
      );

      const result = await callTool("filter_by_time", { maxTotalTime: "30 minutes", limit: 20 });
      const text = getText(result);

      expect(text).toContain("AllClean");
      expect(text).not.toContain("Time unverified");
    });

    it("p2-discovery-tools.AC3.11: a '+'-suffixed time ('5+ hours') now parses and is correctly excluded (#162)", async () => {
      const { server, callTool } = makeTestServer();
      registerFilterTools(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ name: "QuickReal", totalTime: "20 min" }),
            makeRecipe({ name: "LongPlus", totalTime: "5+ hours" }),
          ],
        }),
      );

      const result = await callTool("filter_by_time", { maxTotalTime: "30 minutes", limit: 20 });
      const text = getText(result);

      // "5+ hours" now reads as 5 hours → excluded; no longer leaks (and not just flagged).
      expect(text).toContain("QuickReal");
      expect(text).not.toContain("LongPlus");
      expect(text).not.toContain("Time unverified");
    });
  });
});
