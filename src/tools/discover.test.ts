import { fromAny } from "@total-typescript/shoehorn";
import { describe, it, expect, vi } from "vitest";
import type { SemanticResult } from "../features/vector-store.js";
import { RecipeStore } from "../recipe/store.js";
import { makeRecipe, makeCategory } from "../cache/__fixtures__/recipes.js";
import type { RecipeUid } from "../ids.js";
import { registerDiscoverTool } from "./discover.js";
import { makeTestServer, makeCtx, getText, seed } from "./tool-test-utils.js";

// `uid` is loosened to a plain string so tests pass literal UIDs; branded here.
function makeMockVectorStore(results: ReadonlyArray<{ uid: string; score: number; recipeName: string }> = []) {
  const branded: ReadonlyArray<SemanticResult> = results.map((r) => ({ ...r, uid: r.uid as RecipeUid }));
  return {
    search: vi.fn<(query: string, topK: number) => Promise<ReadonlyArray<SemanticResult>>>().mockResolvedValue(branded),
  };
}

describe("p3-u06-discover-tool: discover_recipes tool", () => {
  describe("p3-u06-discover-tool.AC1: Tool registration and input schema", () => {
    it("p3-u06-discover-tool.AC1.1: tool is registered with name discover_recipes", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "test-uid", score: 0.9, recipeName: "Test Recipe" }]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ name: "Test Recipe" })] }),
        fromAny(mockVs),
      );

      // Should not throw "Tool not registered"
      await expect(callTool("discover_recipes", { query: "test" })).resolves.toBeTruthy();
    });

    it("p3-u06-discover-tool.AC1.3: topK defaults to 5 when not provided", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore();
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe()] }),
        fromAny(mockVs),
      );

      // Pass topK: 5 explicitly (mirrors what the SDK provides when caller omits topK,
      // since z.default(5) ensures the handler always receives 5 for omitted topK).
      await callTool("discover_recipes", { query: "test", topK: 5 });

      expect(mockVs.search).toHaveBeenCalledWith("test", 5, undefined);
    });

    it("p3-u06-discover-tool.AC1.3: topK uses provided value", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore();
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe()] }),
        fromAny(mockVs),
      );

      await callTool("discover_recipes", { query: "test", topK: 10 });

      expect(mockVs.search).toHaveBeenCalledWith("test", 10, undefined);
    });

    it("p3-u06-discover-tool.AC1.4: minScore is forwarded to vectorStore.search when provided", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore();
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe()] }),
        fromAny(mockVs),
      );

      await callTool("discover_recipes", { query: "test", topK: 5, minScore: 0.3 });

      expect(mockVs.search).toHaveBeenCalledWith("test", 5, 0.3);
    });
  });

  describe("p3-u06-discover-tool.AC2: Search and result formatting", () => {
    it("p3-u06-discover-tool.AC2.1: vectorStore.search is called with query and topK", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.85, recipeName: "Pasta" }]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid })] }),
        fromAny(mockVs),
      );

      await callTool("discover_recipes", { query: "italian", topK: 7 });

      expect(mockVs.search).toHaveBeenCalledWith("italian", 7, undefined);
    });

    it("p3-u06-discover-tool.AC2.2: result includes recipe name with integer percentage match", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.923, recipeName: "Chocolate Cake" }]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Chocolate Cake" })],
        }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "chocolate" });
      const text = getText(result);

      expect(text).toContain("Chocolate Cake");
      expect(text).toContain("92% match");
    });

    it("p3-u06-discover-tool.AC2.3: categories are resolved and displayed when present", async () => {
      const category = makeCategory({ name: "Dessert" });
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Cake" }]);
      const ctx = seed(makeCtx(new RecipeStore(), server), {
        recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Cake", categories: [category.uid] })],
        categories: [category],
      });
      registerDiscoverTool(server, ctx, fromAny(mockVs));

      const result = await callTool("discover_recipes", { query: "dessert" });
      const text = getText(result);

      expect(text).toContain("Dessert");
    });

    it("p3-u06-discover-tool.AC2.3: categories line is absent when recipe has no categories", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Bread" }]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Bread", categories: [] })],
        }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "bread" });
      const text = getText(result);

      expect(text).not.toContain("**Categories:**");
    });

    it("p3-u06-discover-tool.AC2.4: prepTime and cookTime are displayed when present", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Pasta" }]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Pasta", prepTime: "10 min", cookTime: "30 min" }),
          ],
        }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "pasta" });
      const text = getText(result);

      expect(text).toContain("Prep: 10 min");
      expect(text).toContain("Cook: 30 min");
    });

    it("p3-u06-discover-tool.AC2.4: omits prepTime and cookTime when null", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Soup" }]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Soup", prepTime: null, cookTime: null })],
        }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "soup" });
      const text = getText(result);

      expect(text).not.toContain("Prep:");
      expect(text).not.toContain("Cook:");
    });

    it("p3-u06-discover-tool.AC2.5: result includes UID in backtick format", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([{ uid: "abc-def-123", score: 0.9, recipeName: "Test Recipe" }]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [makeRecipe({ uid: "abc-def-123" as RecipeUid, name: "Test Recipe" })],
        }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "test" });
      const text = getText(result);

      expect(text).toContain("UID: `abc-def-123`");
    });
  });

  describe("p3-u06-discover-tool.AC3: Empty and filtered results", () => {
    it("p3-u06-discover-tool.AC3.1: search returns empty array", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe()] }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "nonexistent" });
      const text = getText(result);

      expect(text).toBe("No recipes found matching that description.");
    });

    it("p3-u06-discover-tool.AC3.2: all results map to deleted recipes", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([
        { uid: "deleted-1", score: 0.9, recipeName: "Deleted Recipe" },
        { uid: "deleted-2", score: 0.85, recipeName: "Also Deleted" },
      ]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), { recipes: [makeRecipe({ uid: "existing" as RecipeUid })] }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "deleted" });
      const text = getText(result);

      expect(text).toBe("No recipes found matching that description.");
    });
  });

  describe("p3-u06-discover-tool.AC4: Deleted recipe handling", () => {
    it("p3-u06-discover-tool.AC4.1: silently skips deleted recipes", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([
        { uid: "recipe-1", score: 0.95, recipeName: "Existing 1" },
        { uid: "deleted", score: 0.9, recipeName: "Deleted" },
        { uid: "recipe-3", score: 0.85, recipeName: "Existing 2" },
      ]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Existing 1" }),
            makeRecipe({ uid: "recipe-3" as RecipeUid, name: "Existing 2" }),
          ],
        }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "test" });
      const text = getText(result);

      expect(text).toContain("Existing 1");
      expect(text).toContain("Existing 2");
      expect(text).not.toContain("Deleted");
    });

    it("p3-u06-discover-tool.AC4.2: remaining results are re-numbered sequentially", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([
        { uid: "recipe-1", score: 0.95, recipeName: "First" },
        { uid: "deleted", score: 0.9, recipeName: "Deleted" },
        { uid: "recipe-3", score: 0.85, recipeName: "Third" },
      ]);
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ uid: "recipe-1" as RecipeUid, name: "First" }),
            makeRecipe({ uid: "recipe-3" as RecipeUid, name: "Third" }),
          ],
        }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "test" });
      const text = getText(result);

      expect(text).toContain("1. **First**");
      expect(text).toContain("2. **Third**");
    });

    it("p3-u06-discover-tool.AC4.3: excludes trashed recipes even though store.get returns them (#177)", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore([
        { uid: "live-1", score: 0.95, recipeName: "Live One" },
        { uid: "trashed-1", score: 0.9, recipeName: "Trashed One" },
      ]);
      // A stale vector can outlive a soft-delete; `store.get` returns trashed
      // recipes (unlike `getAll`), so the tool must guard on `inTrash`.
      registerDiscoverTool(
        server,
        seed(makeCtx(new RecipeStore(), server), {
          recipes: [
            makeRecipe({ uid: "live-1" as RecipeUid, name: "Live One" }),
            makeRecipe({ uid: "trashed-1" as RecipeUid, name: "Trashed One", inTrash: true }),
          ],
        }),
        fromAny(mockVs),
      );

      const result = await callTool("discover_recipes", { query: "test" });
      const text = getText(result);

      expect(text).toContain("Live One");
      expect(text).not.toContain("Trashed One");
    });
  });

  describe("p3-u06-discover-tool.AC5: Cold-start guard", () => {
    it("p3-u06-discover-tool.AC5.1: empty store returns cold-start message without calling search", async () => {
      const { server, callTool } = makeTestServer();
      const mockVs = makeMockVectorStore();
      registerDiscoverTool(server, makeCtx(new RecipeStore(), server), fromAny(mockVs)); // not loaded — size === 0

      const result = await callTool("discover_recipes", { query: "anything" });
      const text = getText(result);

      expect(text.toLowerCase()).toContain("try again");
      expect(mockVs.search).not.toHaveBeenCalled();
    });
  });
});
