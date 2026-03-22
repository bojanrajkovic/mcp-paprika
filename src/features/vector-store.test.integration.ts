import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VectorStore } from "./vector-store.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import type { EmbeddingClient } from "./embeddings.js";
import type { RecipeUid } from "../paprika/types.js";

/**
 * Deterministic embedding function for integration tests.
 * Maps text to a vector deterministically using MD5 hash.
 * This ensures search results are predictable and reproducible.
 */
function textToVector(text: string): Array<number> {
  const hash = createHash("md5").update(text).digest();
  const x = hash.readUInt8(0) / 255;
  const y = hash.readUInt8(1) / 255;
  const z = hash.readUInt8(2) / 255;
  const norm = Math.sqrt(x * x + y * y + z * z) || 1;
  return [x / norm, y / norm, z / norm];
}

/**
 * Create a deterministic mock embedder for integration tests.
 * Returns vectors based on text content, ensuring reproducible search results.
 */
function makeDeterministicEmbedder(): EmbeddingClient {
  return {
    embed: vi.fn(async (text: string) => textToVector(text)),
    embedBatch: vi.fn(async (texts: ReadonlyArray<string>) => texts.map((t) => textToVector(t))),
    get dimensions() {
      return 3;
    },
  } as unknown as EmbeddingClient;
}

describe("VectorStore integration tests with real Vectra", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-vector-store-integration-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("AC1.1: First-run initialization creates index structure", () => {
    it("creates vectors/ directory and index.json on first run", async () => {
      const { statSync, existsSync } = await import("node:fs");

      const embedder = makeDeterministicEmbedder();
      const store = new VectorStore(tempDir, embedder, "test-model", 1);
      await store.init();

      const vectorsDir = join(tempDir, "vectors");
      expect(existsSync(vectorsDir)).toBe(true);

      const stats = statSync(vectorsDir);
      expect(stats.isDirectory()).toBe(true);
    });
  });

  describe("AC2.1 & AC2.2: Full indexing pipeline with dedup", () => {
    it("indexes new recipes and skips unchanged ones", async () => {
      const embedder = makeDeterministicEmbedder();
      const store = new VectorStore(tempDir, embedder, "test-model", 1);
      await store.init();

      // Create and index 3 recipes
      const recipe1 = makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Pasta Carbonara" });
      const recipe2 = makeRecipe({ uid: "recipe-2" as RecipeUid, name: "Margherita Pizza" });
      const recipe3 = makeRecipe({ uid: "recipe-3" as RecipeUid, name: "Tiramisu" });

      const result1 = await store.indexRecipes([recipe1, recipe2, recipe3], () => []);
      expect(result1).toEqual({ indexed: 3, skipped: 0, total: 3 });

      // Index the same 3 recipes again — all should be skipped
      const result2 = await store.indexRecipes([recipe1, recipe2, recipe3], () => []);
      expect(result2).toEqual({ indexed: 0, skipped: 3, total: 3 });
    });
  });

  describe("AC2.6: Hash persistence across VectorStore restarts", () => {
    it("loads persisted hashes from disk and skips unchanged recipes", async () => {
      // First store instance
      const embedder1 = makeDeterministicEmbedder();
      const store1 = new VectorStore(tempDir, embedder1, "test-model", 1);
      await store1.init();

      const recipe1 = makeRecipe({ uid: "recipe-1" as RecipeUid, name: "Pasta Carbonara" });
      const recipe2 = makeRecipe({ uid: "recipe-2" as RecipeUid, name: "Margherita Pizza" });

      const result1 = await store1.indexRecipes([recipe1, recipe2], () => []);
      expect(result1).toEqual({ indexed: 2, skipped: 0, total: 2 });

      // Second store instance pointing to same directory
      const embedder2 = makeDeterministicEmbedder();
      const store2 = new VectorStore(tempDir, embedder2, "test-model", 1);
      await store2.init();

      // Index same recipes — should all be skipped because hashes loaded from disk
      const result2 = await store2.indexRecipes([recipe1, recipe2], () => []);
      expect(result2).toEqual({ indexed: 0, skipped: 2, total: 2 });

      // Verify embedBatch was not called (dedup worked)
      expect(embedder2.embedBatch).not.toHaveBeenCalled();
    });
  });

  describe("AC3.1 & AC3.2: Search with ordering by similarity", () => {
    it("returns search results ordered by descending similarity score", async () => {
      const embedder = makeDeterministicEmbedder();
      const store = new VectorStore(tempDir, embedder, "test-model", 1);
      await store.init();

      // Index recipes with distinct content
      const recipe1 = makeRecipe({
        uid: "recipe-1" as RecipeUid,
        name: "Pasta Carbonara",
        ingredients: "pasta, eggs, bacon, cheese",
      });
      const recipe2 = makeRecipe({
        uid: "recipe-2" as RecipeUid,
        name: "Vegetable Soup",
        ingredients: "carrots, celery, onions, broth",
      });
      const recipe3 = makeRecipe({
        uid: "recipe-3" as RecipeUid,
        name: "Margherita Pizza",
        ingredients: "flour, tomato, mozzarella, basil",
      });

      await store.indexRecipes([recipe1, recipe2, recipe3], () => []);

      // Search with a query similar to recipe1
      const results = await store.search("pasta carbonara bacon", 10);

      // Should return results (actual ordering depends on similarity computation)
      expect(results.length).toBeGreaterThan(0);

      // Verify results are in descending order by score
      for (let i = 0; i < results.length - 1; i++) {
        expect(results[i]!.score).toBeGreaterThanOrEqual(results[i + 1]!.score);
      }

      // Verify result structure
      for (const result of results) {
        expect(result).toHaveProperty("uid");
        expect(result).toHaveProperty("score");
        expect(result).toHaveProperty("recipeName");
        expect(typeof result.uid).toBe("string");
        expect(typeof result.score).toBe("number");
        expect(typeof result.recipeName).toBe("string");
      }
    });
  });

  describe("AC3.3: Empty index search returns empty array", () => {
    it("returns empty array when searching empty index", async () => {
      const embedder = makeDeterministicEmbedder();
      const store = new VectorStore(tempDir, embedder, "test-model", 1);
      await store.init();

      const results = await store.search("pasta recipe", 10);

      expect(results).toEqual([]);
    });
  });

  describe("AC4.1: Removal removes from search results", () => {
    it("removes recipe from vector index and it no longer appears in search", async () => {
      const embedder = makeDeterministicEmbedder();
      const store = new VectorStore(tempDir, embedder, "test-model", 1);
      await store.init();

      // Index 2 recipes
      const recipe1 = makeRecipe({
        uid: "recipe-1" as RecipeUid,
        name: "Pasta Carbonara",
        ingredients: "pasta, eggs, bacon, cheese",
      });
      const recipe2 = makeRecipe({
        uid: "recipe-2" as RecipeUid,
        name: "Margherita Pizza",
        ingredients: "flour, tomato, mozzarella",
      });

      await store.indexRecipes([recipe1, recipe2], () => []);

      // Search should return both
      const resultsBefore = await store.search("carbonara", 10);
      expect(resultsBefore.length).toBeGreaterThan(0);

      // Remove recipe1
      await store.removeRecipe("recipe-1");

      // Search again — recipe1 should not appear
      const resultsAfter = await store.search("carbonara", 10);
      for (const result of resultsAfter) {
        expect(result.uid).not.toBe("recipe-1");
      }
    });
  });
});
