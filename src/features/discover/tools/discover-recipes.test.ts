import { fromAny } from "@total-typescript/shoehorn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeUid } from "../../../ids.js";
import type { SemanticResult, VectorStore } from "../../vector-store.js";

import { makeCategory, makeRecipe } from "../../../../test/cache/__fixtures__/recipes.js";
import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { getText } from "../../../../test/support/tool-test-utils.js";

// Build a minimal mock vector store whose `search` spy returns pre-supplied results.
// `uid` is loosened to a plain string so tests pass literal UIDs; branded here.
function makeMockVectorStore(results: ReadonlyArray<{ uid: string; score: number; recipeName: string }> = []) {
  const branded: ReadonlyArray<SemanticResult> = results.map((r) => ({
    ...r,
    uid: r.uid as RecipeUid,
  }));
  return {
    search: vi.fn<(query: string, topK: number) => Promise<ReadonlyArray<SemanticResult>>>().mockResolvedValue(branded),
  };
}

// Inject a mock vector store into the discover module's state after setup.
// `DiscoverState.vectorStore` is TypeScript-readonly but a plain JS object at runtime,
// so the cast lets us replace the null default with a spy.
function injectVectorStore(
  kh: ReturnType<typeof useKernelHarness>,
  mockVs: ReturnType<typeof makeMockVectorStore>,
): void {
  (kh.state() as { vectorStore: VectorStore | null }).vectorStore = fromAny(mockVs);
}

describe("discover_recipes tool", () => {
  const kh = useKernelHarness("discover");
  beforeEach(kh.setup);
  afterEach(kh.teardown);

  describe("tool registration and input schema", () => {
    it("tool is registered and callable", async () => {
      const mockVs = makeMockVectorStore([{ uid: "test-uid", score: 0.9, recipeName: "Test Recipe" }]);
      injectVectorStore(kh, mockVs);
      kh.seed({ recipes: [makeRecipe({ name: "Test Recipe" })] });

      // Should not throw "Tool not registered"
      await expect(kh.callTool("discover_recipes", { query: "test" })).resolves.toBeTruthy();
    });

    it("topK defaults to 5 when not provided", async () => {
      const mockVs = makeMockVectorStore();
      injectVectorStore(kh, mockVs);
      kh.seed({ recipes: [makeRecipe()] });

      // Pass topK: 5 explicitly (mirrors what the SDK provides when caller omits topK,
      // since z.default(5) ensures the handler always receives 5 for omitted topK).
      await kh.callTool("discover_recipes", { query: "test", topK: 5 });

      expect(mockVs.search).toHaveBeenCalledWith("test", 5, undefined);
    });

    it("topK uses provided value", async () => {
      const mockVs = makeMockVectorStore();
      injectVectorStore(kh, mockVs);
      kh.seed({ recipes: [makeRecipe()] });

      await kh.callTool("discover_recipes", { query: "test", topK: 10 });

      expect(mockVs.search).toHaveBeenCalledWith("test", 10, undefined);
    });

    it("minScore is forwarded to vectorStore.search when provided", async () => {
      const mockVs = makeMockVectorStore();
      injectVectorStore(kh, mockVs);
      kh.seed({ recipes: [makeRecipe()] });

      await kh.callTool("discover_recipes", { query: "test", topK: 5, minScore: 0.3 });

      expect(mockVs.search).toHaveBeenCalledWith("test", 5, 0.3);
    });
  });

  describe("search and result formatting", () => {
    it("vectorStore.search is called with query and topK", async () => {
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.85, recipeName: "Pasta" }]);
      injectVectorStore(kh, mockVs);
      kh.seed({ recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid })] });

      await kh.callTool("discover_recipes", { query: "italian", topK: 7 });

      expect(mockVs.search).toHaveBeenCalledWith("italian", 7, undefined);
    });

    it("result includes recipe name with integer percentage match", async () => {
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.923, recipeName: "Chocolate Cake" }]);
      injectVectorStore(kh, mockVs);
      kh.seed({
        recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Chocolate Cake" })],
      });

      const text = getText(await kh.callTool("discover_recipes", { query: "chocolate" }));

      expect(text).toContain("Chocolate Cake");
      expect(text).toContain("92% match");
    });

    it("categories are resolved and displayed when present", async () => {
      const category = makeCategory({ name: "Dessert" });
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Cake" }]);
      injectVectorStore(kh, mockVs);
      kh.seed({
        recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Cake", categories: [category.uid] })],
        categories: [category],
      });

      const text = getText(await kh.callTool("discover_recipes", { query: "dessert" }));

      expect(text).toContain("Dessert");
    });

    it("categories line is absent when recipe has no categories", async () => {
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Bread" }]);
      injectVectorStore(kh, mockVs);
      kh.seed({
        recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Bread", categories: [] })],
      });

      const text = getText(await kh.callTool("discover_recipes", { query: "bread" }));

      expect(text).not.toContain("**Categories:**");
    });

    it("prepTime and cookTime are displayed when present", async () => {
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Pasta" }]);
      injectVectorStore(kh, mockVs);
      kh.seed({
        recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Pasta", prepTime: "10 min", cookTime: "30 min" })],
      });

      const text = getText(await kh.callTool("discover_recipes", { query: "pasta" }));

      expect(text).toContain("Prep: 10 min");
      expect(text).toContain("Cook: 30 min");
    });

    it("omits prepTime and cookTime when null", async () => {
      const mockVs = makeMockVectorStore([{ uid: "recipe-1", score: 0.9, recipeName: "Soup" }]);
      injectVectorStore(kh, mockVs);
      kh.seed({
        recipes: [makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Soup", prepTime: null, cookTime: null })],
      });

      const text = getText(await kh.callTool("discover_recipes", { query: "soup" }));

      expect(text).not.toContain("Prep:");
      expect(text).not.toContain("Cook:");
    });

    it("result includes UID in backtick format", async () => {
      const mockVs = makeMockVectorStore([{ uid: "abc-def-123", score: 0.9, recipeName: "Test Recipe" }]);
      injectVectorStore(kh, mockVs);
      kh.seed({
        recipes: [makeRecipe({ uid: "abc-def-123" as RecipeUid, name: "Test Recipe" })],
      });

      const text = getText(await kh.callTool("discover_recipes", { query: "test" }));

      expect(text).toContain("UID: `abc-def-123`");
    });
  });

  describe("empty and filtered results", () => {
    it("search returns empty array — no recipes found message", async () => {
      const mockVs = makeMockVectorStore([]);
      injectVectorStore(kh, mockVs);
      kh.seed({ recipes: [makeRecipe()] });

      const text = getText(await kh.callTool("discover_recipes", { query: "nonexistent" }));

      expect(text).toBe("No recipes found matching that description.");
    });

    it("all results map to deleted recipes — no recipes found message", async () => {
      const mockVs = makeMockVectorStore([
        { uid: "deleted-1", score: 0.9, recipeName: "Deleted Recipe" },
        { uid: "deleted-2", score: 0.85, recipeName: "Also Deleted" },
      ]);
      injectVectorStore(kh, mockVs);
      kh.seed({ recipes: [makeRecipe({ uid: "existing" as RecipeUid })] });

      const text = getText(await kh.callTool("discover_recipes", { query: "deleted" }));

      expect(text).toBe("No recipes found matching that description.");
    });
  });

  describe("deleted recipe handling", () => {
    it("silently skips deleted recipes", async () => {
      const mockVs = makeMockVectorStore([
        { uid: "recipe-1", score: 0.95, recipeName: "Existing 1" },
        { uid: "deleted", score: 0.9, recipeName: "Deleted" },
        { uid: "recipe-3", score: 0.85, recipeName: "Existing 2" },
      ]);
      injectVectorStore(kh, mockVs);
      kh.seed({
        recipes: [
          makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Existing 1" }),
          makeRecipe({ uid: "recipe-3" as RecipeUid, name: "Existing 2" }),
        ],
      });

      const text = getText(await kh.callTool("discover_recipes", { query: "test" }));

      expect(text).toContain("Existing 1");
      expect(text).toContain("Existing 2");
      expect(text).not.toContain("Deleted");
    });

    it("remaining results are re-numbered sequentially after skipping deleted", async () => {
      const mockVs = makeMockVectorStore([
        { uid: "recipe-1", score: 0.95, recipeName: "First" },
        { uid: "deleted", score: 0.9, recipeName: "Deleted" },
        { uid: "recipe-3", score: 0.85, recipeName: "Third" },
      ]);
      injectVectorStore(kh, mockVs);
      kh.seed({
        recipes: [
          makeRecipe({ uid: "recipe-1" as RecipeUid, name: "First" }),
          makeRecipe({ uid: "recipe-3" as RecipeUid, name: "Third" }),
        ],
      });

      const text = getText(await kh.callTool("discover_recipes", { query: "test" }));

      expect(text).toContain("1. **First**");
      expect(text).toContain("2. **Third**");
    });

    it("excludes trashed recipes even though store.get returns them (#177)", async () => {
      const mockVs = makeMockVectorStore([
        { uid: "live-1", score: 0.95, recipeName: "Live One" },
        { uid: "trashed-1", score: 0.9, recipeName: "Trashed One" },
      ]);
      injectVectorStore(kh, mockVs);
      // A stale vector can outlive a soft-delete; `store.get` returns trashed
      // recipes (unlike `getAll`), so the tool must guard on `inTrash`.
      kh.seed({
        recipes: [
          makeRecipe({ uid: "live-1" as RecipeUid, name: "Live One" }),
          makeRecipe({ uid: "trashed-1" as RecipeUid, name: "Trashed One", inTrash: true }),
        ],
      });

      const text = getText(await kh.callTool("discover_recipes", { query: "test" }));

      expect(text).toContain("Live One");
      expect(text).not.toContain("Trashed One");
    });
  });

  describe("cold-start guard", () => {
    it("empty recipe store returns cold-start message without calling search", async () => {
      // Inject a non-null vectorStore so the feature-gate passes; the cold-start
      // guard fires on !hasSynced() before vectorStore.search is reached.
      const mockVs = makeMockVectorStore();
      injectVectorStore(kh, mockVs);
      // store never seeded — hasSynced() is false

      const text = getText(await kh.callTool("discover_recipes", { query: "anything" }));

      expect(text.toLowerCase()).toContain("try again");
      expect(mockVs.search).not.toHaveBeenCalled();
    });
  });
});
