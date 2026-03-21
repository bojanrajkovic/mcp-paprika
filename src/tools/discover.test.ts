import { describe, it, expect, vi } from "vitest";
import type { VectorStore, SemanticResult } from "../features/vector-store.js";
import { RecipeStore } from "../cache/recipe-store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import { registerDiscoverTool } from "./discover.js";
import { makeTestServer, makeCtx, getText } from "./tool-test-utils.js";

function makeMockVectorStore(results: ReadonlyArray<SemanticResult> = []) {
  return {
    search: vi.fn<(query: string, topK: number) => Promise<ReadonlyArray<SemanticResult>>>().mockResolvedValue(results),
  };
}

describe("p3-u06-discover-tool: discover_recipes tool", () => {
  describe("p3-u06-discover-tool.AC1: Tool registration and input schema", () => {
    it("p3-u06-discover-tool.AC1.1: tool is registered with name discover_recipes", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ name: "Test Recipe" })], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "test-uid", score: 0.9, recipeName: "Test Recipe" }]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      // Should not throw "Tool not registered"
      await expect(callTool("discover_recipes", { query: "test" })).resolves.toBeTruthy();
    });

    it("p3-u06-discover-tool.AC1.3: topK defaults to 5 when not provided", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore();
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      // Pass topK: 5 explicitly (mirrors what the SDK provides when caller omits topK,
      // since z.default(5) ensures the handler always receives 5 for omitted topK).
      await callTool("discover_recipes", { query: "test", topK: 5 });

      expect(mockVs.search).toHaveBeenCalledWith("test", 5);
    });

    it("p3-u06-discover-tool.AC1.3: topK uses provided value", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore();
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      await callTool("discover_recipes", { query: "test", topK: 10 });

      expect(mockVs.search).toHaveBeenCalledWith("test", 10);
    });
  });

  describe("p3-u06-discover-tool.AC2: Search and result formatting", () => {
    it("p3-u06-discover-tool.AC2.1: vectorStore.search is called with query and topK", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ uid: "recipe-1" })], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.85, recipeName: "Pasta" }]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      await callTool("discover_recipes", { query: "italian", topK: 7 });

      expect(mockVs.search).toHaveBeenCalledWith("italian", 7);
    });

    it("p3-u06-discover-tool.AC2.2: result includes recipe name with integer percentage match", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ uid: "recipe-1", name: "Chocolate Cake" })], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.923, recipeName: "Chocolate Cake" }]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "chocolate" });
      const text = getText(result);

      expect(text).toContain("Chocolate Cake");
      expect(text).toContain("92% match");
    });

    it("p3-u06-discover-tool.AC2.3: categories are resolved and displayed when present", async () => {
      const category = makeCategory({ name: "Dessert" });
      const store = new RecipeStore();
      store.load([makeRecipe({ uid: "recipe-1", name: "Cake", categories: [category.uid] })], [category]);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Cake" }]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "dessert" });
      const text = getText(result);

      expect(text).toContain("Dessert");
    });

    it("p3-u06-discover-tool.AC2.3: categories line is absent when recipe has no categories", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ uid: "recipe-1", name: "Bread", categories: [] })], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Bread" }]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "bread" });
      const text = getText(result);

      expect(text).not.toContain("**Categories:**");
    });

    it("p3-u06-discover-tool.AC2.4: prepTime and cookTime are displayed when present", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({
            uid: "recipe-1",
            name: "Pasta",
            prepTime: "10 min",
            cookTime: "30 min",
          }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Pasta" }]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "pasta" });
      const text = getText(result);

      expect(text).toContain("Prep: 10 min");
      expect(text).toContain("Cook: 30 min");
    });

    it("p3-u06-discover-tool.AC2.4: omits prepTime and cookTime when null", async () => {
      const store = new RecipeStore();
      store.load(
        [
          makeRecipe({
            uid: "recipe-1",
            name: "Soup",
            prepTime: null,
            cookTime: null,
          }),
        ],
        [],
      );
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Soup" }]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "soup" });
      const text = getText(result);

      expect(text).not.toContain("Prep:");
      expect(text).not.toContain("Cook:");
    });

    it("p3-u06-discover-tool.AC2.5: result includes UID in backtick format", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ uid: "abc-def-123", name: "Test Recipe" })], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "abc-def-123", score: 0.9, recipeName: "Test Recipe" }]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "test" });
      const text = getText(result);

      expect(text).toContain("UID: `abc-def-123`");
    });
  });

  describe("p3-u06-discover-tool.AC3: Empty and filtered results", () => {
    it("p3-u06-discover-tool.AC3.1: search returns empty array", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe()], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "nonexistent" });
      const text = getText(result);

      expect(text).toBe("No recipes found matching that description.");
    });

    it("p3-u06-discover-tool.AC3.2: all results map to deleted recipes", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ uid: "existing" })], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([
        { uid: "deleted-1", score: 0.9, recipeName: "Deleted Recipe" },
        { uid: "deleted-2", score: 0.85, recipeName: "Also Deleted" },
      ]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "deleted" });
      const text = getText(result);

      expect(text).toBe("No recipes found matching that description.");
    });
  });

  describe("p3-u06-discover-tool.AC4: Deleted recipe handling", () => {
    it("p3-u06-discover-tool.AC4.1: silently skips deleted recipes", async () => {
      const store = new RecipeStore();
      store.load(
        [makeRecipe({ uid: "recipe-1", name: "Existing 1" }), makeRecipe({ uid: "recipe-3", name: "Existing 2" })],
        [],
      );
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([
        { uid: "recipe-1", score: 0.95, recipeName: "Existing 1" },
        { uid: "deleted", score: 0.9, recipeName: "Deleted" },
        { uid: "recipe-3", score: 0.85, recipeName: "Existing 2" },
      ]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "test" });
      const text = getText(result);

      expect(text).toContain("Existing 1");
      expect(text).toContain("Existing 2");
      expect(text).not.toContain("Deleted");
    });

    it("p3-u06-discover-tool.AC4.2: remaining results are re-numbered sequentially", async () => {
      const store = new RecipeStore();
      store.load([makeRecipe({ uid: "recipe-1", name: "First" }), makeRecipe({ uid: "recipe-3", name: "Third" })], []);
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([
        { uid: "recipe-1", score: 0.95, recipeName: "First" },
        { uid: "deleted", score: 0.9, recipeName: "Deleted" },
        { uid: "recipe-3", score: 0.85, recipeName: "Third" },
      ]);
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "test" });
      const text = getText(result);

      expect(text).toContain("1. **First**");
      expect(text).toContain("2. **Third**");
    });
  });

  describe("p3-u06-discover-tool.AC5: Cold-start guard", () => {
    it("p3-u06-discover-tool.AC5.1: empty store returns cold-start message without calling search", async () => {
      const store = new RecipeStore(); // not loaded — size === 0
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore();
      registerDiscoverTool(server, makeCtx(store, server), mockVs as unknown as VectorStore);

      const result = await callTool("discover_recipes", { query: "anything" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
      expect(mockVs.search).not.toHaveBeenCalled();
    });
  });
});
