import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { contentHash, VectorStore } from "./vector-store.js";
import { VectorStoreError } from "./vector-store-errors.js";
import { recipeToEmbeddingText } from "./embeddings.js";
import { makeRecipe } from "../cache/__fixtures__/recipes.js";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EmbeddingClient } from "./embeddings.js";

describe("VectorStore contentHash", () => {
  describe("AC5.1: SHA-256 stability", () => {
    it("produces a stable SHA-256 hex digest for the same input text", () => {
      const input = "hello";
      const hash1 = contentHash(input);
      const hash2 = contentHash(input);

      expect(hash1).toBe(hash2);
    });

    it("produces a 64-character hex string", () => {
      const hash = contentHash("test");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("produces different hashes for different inputs", () => {
      const hash1 = contentHash("hello");
      const hash2 = contentHash("world");

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("AC5.2: Changing directions does not change hash", () => {
    it("recipes with different directions produce the same hash", () => {
      const recipe1 = makeRecipe({ directions: "Step 1: Mix" });
      const recipe2 = makeRecipe({ ...recipe1, directions: "Step 1: Mix\nStep 2: Bake" });

      const text1 = recipeToEmbeddingText(recipe1, []);
      const text2 = recipeToEmbeddingText(recipe2, []);
      const hash1 = contentHash(text1);
      const hash2 = contentHash(text2);

      // Embedding text excludes directions, so hashes should match
      expect(hash1).toBe(hash2);
    });
  });

  describe("AC5.3: Changing ingredients changes hash", () => {
    it("recipes with different ingredients produce different hashes", () => {
      const recipe1 = makeRecipe({ ingredients: "flour" });
      const recipe2 = makeRecipe({ ...recipe1, ingredients: "sugar" });

      const text1 = recipeToEmbeddingText(recipe1, []);
      const text2 = recipeToEmbeddingText(recipe2, []);
      const hash1 = contentHash(text1);
      const hash2 = contentHash(text2);

      // Embedding text includes ingredients, so hashes should differ
      expect(hash1).not.toBe(hash2);
    });
  });
});

describe("VectorStore VectorStoreError", () => {
  it("extends Error", () => {
    const error = new VectorStoreError("test message");
    expect(error instanceof Error).toBe(true);
  });

  it("has name set to VectorStoreError", () => {
    const error = new VectorStoreError("test message");
    expect(error.name).toBe("VectorStoreError");
  });

  it("has correct message", () => {
    const error = new VectorStoreError("test message");
    expect(error.message).toBe("test message");
  });

  it("supports ErrorOptions cause chaining", () => {
    const cause = new Error("original error");
    const error = new VectorStoreError("wrapped error", { cause });
    expect(error.cause).toBe(cause);
  });
});

// Mock setup for all init and operation tests
vi.mock("vectra", () => {
  const MockLocalIndex = vi.fn();
  MockLocalIndex.prototype.isIndexCreated = vi.fn();
  MockLocalIndex.prototype.createIndex = vi.fn();
  MockLocalIndex.prototype.beginUpdate = vi.fn();
  MockLocalIndex.prototype.endUpdate = vi.fn();
  MockLocalIndex.prototype.cancelUpdate = vi.fn();
  MockLocalIndex.prototype.upsertItem = vi.fn();
  MockLocalIndex.prototype.deleteItem = vi.fn();
  MockLocalIndex.prototype.queryItems = vi.fn();
  return { LocalIndex: MockLocalIndex };
});

function makeMockEmbedder(): EmbeddingClient {
  return {
    embed: vi.fn<(text: string) => Promise<Array<number>>>(),
    embedBatch: vi.fn<(texts: ReadonlyArray<string>) => Promise<Array<Array<number>>>>(),
    get dimensions() {
      return 3;
    },
  } as unknown as EmbeddingClient;
}

describe("VectorStore init", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-vector-store-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("AC1.1: First run - creates index and empty hash map", () => {
    it("creates Vectra index when none exists", async () => {
      const { LocalIndex } = await import("vectra");
      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockCreateIndex = vi.spyOn((LocalIndex as any).prototype, "createIndex");

      mockIsIndexCreated.mockResolvedValue(false);
      mockCreateIndex.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      const store = new VectorStore(tempDir, embedder);
      await store.init();

      expect(mockIsIndexCreated).toHaveBeenCalled();
      expect(mockCreateIndex).toHaveBeenCalled();
      expect(store.size).toBe(0);
    });
  });

  describe("AC1.2: Subsequent run - loads existing hash map and opens index", () => {
    it("loads valid hash-index.json and does not recreate index", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockCreateIndex = vi.spyOn((LocalIndex as any).prototype, "createIndex");

      // Write valid hash-index.json before init
      const vectorsDir = join(tempDir, "vectors");
      await mkdir(vectorsDir, { recursive: true });
      const hashIndexPath = join(vectorsDir, "hash-index.json");
      const validIndex = { "recipe-1": "hash-abc", "recipe-2": "hash-def" };
      await writeFile(hashIndexPath, JSON.stringify(validIndex));

      mockIsIndexCreated.mockResolvedValue(true);
      mockCreateIndex.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      const store = new VectorStore(tempDir, embedder);
      await store.init();

      // Verify index was already created so createIndex not called
      expect(mockIsIndexCreated).toHaveBeenCalled();
      expect(mockCreateIndex).not.toHaveBeenCalled();
      // Verify hash map was loaded
      expect(store.size).toBe(2);
    });
  });

  describe("AC1.3: Corruption recovery - invalid JSON", () => {
    it("recovers from corrupted hash-index.json (invalid JSON)", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");

      // Write invalid JSON to hash-index.json
      const vectorsDir = join(tempDir, "vectors");
      await mkdir(vectorsDir, { recursive: true });
      const hashIndexPath = join(vectorsDir, "hash-index.json");
      await writeFile(hashIndexPath, "{invalid json");

      mockIsIndexCreated.mockResolvedValue(true);

      const embedder = makeMockEmbedder();
      const store = new VectorStore(tempDir, embedder);
      await store.init();

      // Verify stderr logged corruption message
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("corrupt"));

      // Verify backup was created
      const backupPath = `${hashIndexPath}.bak`;
      const backupContent = await readFile(backupPath, "utf-8");
      expect(backupContent).toBe("{invalid json");

      // Verify store was reset to empty
      expect(store.size).toBe(0);

      stderrSpy.mockRestore();
    });

    it("recovers from corrupted hash-index.json (schema mismatch)", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");

      // Write valid JSON but invalid schema (not a record, but an array)
      const vectorsDir = join(tempDir, "vectors");
      await mkdir(vectorsDir, { recursive: true });
      const hashIndexPath = join(vectorsDir, "hash-index.json");
      await writeFile(hashIndexPath, JSON.stringify(["not", "a", "record"]));

      mockIsIndexCreated.mockResolvedValue(true);

      const embedder = makeMockEmbedder();
      const store = new VectorStore(tempDir, embedder);
      await store.init();

      // Verify stderr logged corruption message
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("corrupt"));

      // Verify store was reset to empty
      expect(store.size).toBe(0);

      stderrSpy.mockRestore();
    });
  });

  describe("AC1.4: Corruption recovery - corrupted Vectra index", () => {
    it("recovers from corrupted Vectra index by recreating", async () => {
      const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockCreateIndex = vi.spyOn((LocalIndex as any).prototype, "createIndex");

      // Simulate corruption by throwing when calling isIndexCreated
      mockIsIndexCreated.mockRejectedValueOnce(new Error("Index corrupted"));
      mockCreateIndex.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      const store = new VectorStore(tempDir, embedder);
      await store.init();

      // Verify stderr logged corruption message
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("corrupt"));

      // Verify hash map was cleared
      expect(store.size).toBe(0);

      stderrSpy.mockRestore();
    });
  });
});

describe("VectorStore indexRecipes", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-vector-store-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("AC2.1: Embeds and upserts recipes with changed content hash", () => {
    it("calls embedBatch and upserts items for new recipes", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((LocalIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((LocalIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((LocalIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([
        [1, 0, 0],
        [0, 1, 0],
      ]);

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const recipe1 = makeRecipe({ uid: "recipe-1" });
      const recipe2 = makeRecipe({ uid: "recipe-2" });

      const result = await store.indexRecipes([recipe1, recipe2], () => []);

      expect(embedder.embedBatch).toHaveBeenCalledWith(
        expect.arrayContaining([expect.stringContaining(recipe1.name), expect.stringContaining(recipe2.name)]),
      );
      expect(mockUpsertItem).toHaveBeenCalledTimes(2);
      expect(mockUpsertItem).toHaveBeenCalledWith({
        id: "recipe-1",
        vector: [1, 0, 0],
        metadata: { recipeName: recipe1.name },
      });
      expect(mockUpsertItem).toHaveBeenCalledWith({
        id: "recipe-2",
        vector: [0, 1, 0],
        metadata: { recipeName: recipe2.name },
      });
      expect(result).toEqual({ indexed: 2, skipped: 0, total: 2 });
    });
  });

  describe("AC2.2: Skips recipes with unchanged content hash", () => {
    it("skips recipes with matching content hash", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((LocalIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((LocalIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((LocalIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const recipe = makeRecipe({ uid: "recipe-1" });

      // First indexing
      await store.indexRecipes([recipe], () => []);

      // Reset mocks
      vi.clearAllMocks();
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      // Second indexing with same recipe
      const result = await store.indexRecipes([recipe], () => []);

      expect(embedder.embedBatch).not.toHaveBeenCalled();
      expect(result).toEqual({ indexed: 0, skipped: 1, total: 1 });
    });
  });

  describe("AC2.3: Returns correct IndexingResult with counts", () => {
    it("returns correct indexed, skipped, total counts", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((LocalIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((LocalIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((LocalIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const recipe1 = makeRecipe({ uid: "recipe-1" });

      // First indexing
      await store.indexRecipes([recipe1], () => []);

      // Reset mocks
      vi.clearAllMocks();
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);
      embedder.embedBatch.mockResolvedValue([
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ]);

      // Index 3 recipes: 2 new, 1 unchanged
      const recipe2 = makeRecipe({ uid: "recipe-2" });
      const recipe3 = makeRecipe({ uid: "recipe-3" });

      const result = await store.indexRecipes([recipe1, recipe2, recipe3], () => []);

      expect(result).toEqual({ indexed: 2, skipped: 1, total: 3 });
    });
  });

  describe("AC2.4: Persists hash map after indexing", () => {
    it("writes updated hash-index.json after indexing", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((LocalIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((LocalIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((LocalIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const recipe = makeRecipe({ uid: "recipe-1" });
      await store.indexRecipes([recipe], () => []);

      // Read the persisted hash-index.json
      const hashIndexPath = join(tempDir, "vectors", "hash-index.json");
      const content = await readFile(hashIndexPath, "utf-8");
      const hashes = JSON.parse(content);

      expect(hashes).toHaveProperty("recipe-1");
      expect(typeof hashes["recipe-1"]).toBe("string");
    });
  });

  describe("AC2.5: Empty recipe list returns zero counts", () => {
    it("returns { indexed: 0, skipped: 0, total: 0 } and does not call embedBatch", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");

      mockIsIndexCreated.mockResolvedValue(false);

      const embedder = makeMockEmbedder();

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const result = await store.indexRecipes([], () => []);

      expect(embedder.embedBatch).not.toHaveBeenCalled();
      expect(result).toEqual({ indexed: 0, skipped: 0, total: 0 });
    });
  });

  describe("AC2.6: Hash map persists across VectorStore restarts", () => {
    it("loads previously saved hashes and skips unchanged recipes on restart", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((LocalIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((LocalIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((LocalIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      // First store instance
      const store1 = new VectorStore(tempDir, embedder);
      await store1.init();
      const recipe = makeRecipe({ uid: "recipe-1" });
      await store1.indexRecipes([recipe], () => []);

      // Reset mocks for second instance
      vi.clearAllMocks();
      mockIsIndexCreated.mockResolvedValue(true);
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      // Create new store instance pointing to same tempDir
      const store2 = new VectorStore(tempDir, embedder);
      await store2.init();

      // Index the same recipe again
      const result = await store2.indexRecipes([recipe], () => []);

      // Should skip because hash matches persisted value
      expect(result).toEqual({ indexed: 0, skipped: 1, total: 1 });
      expect(embedder.embedBatch).not.toHaveBeenCalled();
    });
  });
});

describe("VectorStore search", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-vector-store-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("AC3.1: Embeds query and returns SemanticResult array", () => {
    it("returns results with uid, score, and recipeName", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockQueryItems = vi.spyOn((LocalIndex as any).prototype, "queryItems");

      mockIsIndexCreated.mockResolvedValue(false);
      mockQueryItems.mockResolvedValue([
        {
          item: { id: "recipe-1", metadata: { recipeName: "Pasta" } },
          score: 0.95,
        },
        {
          item: { id: "recipe-2", metadata: { recipeName: "Risotto" } },
          score: 0.87,
        },
      ]);

      const embedder = makeMockEmbedder();
      embedder.embed.mockResolvedValue([1, 0, 0]);

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const results = await store.search("pasta recipe", 10);

      expect(embedder.embed).toHaveBeenCalledWith("pasta recipe");
      expect(mockQueryItems).toHaveBeenCalledWith([1, 0, 0], 10);
      expect(results).toEqual([
        { uid: "recipe-1", score: 0.95, recipeName: "Pasta" },
        { uid: "recipe-2", score: 0.87, recipeName: "Risotto" },
      ]);
    });
  });

  describe("AC3.2: Results are ordered by descending similarity score", () => {
    it("returns results sorted by score descending", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockQueryItems = vi.spyOn((LocalIndex as any).prototype, "queryItems");

      mockIsIndexCreated.mockResolvedValue(false);
      mockQueryItems.mockResolvedValue([
        {
          item: { id: "recipe-1", metadata: { recipeName: "Best Match" } },
          score: 0.99,
        },
        {
          item: { id: "recipe-2", metadata: { recipeName: "Good Match" } },
          score: 0.75,
        },
        {
          item: { id: "recipe-3", metadata: { recipeName: "Fair Match" } },
          score: 0.52,
        },
      ]);

      const embedder = makeMockEmbedder();
      embedder.embed.mockResolvedValue([1, 0, 0]);

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const results = await store.search("query", 10);

      expect(results[0]!.score).toBe(0.99);
      expect(results[1]!.score).toBe(0.75);
      expect(results[2]!.score).toBe(0.52);
    });
  });

  describe("AC3.3: Empty index returns empty array", () => {
    it("returns empty array when no results found", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockQueryItems = vi.spyOn((LocalIndex as any).prototype, "queryItems");

      mockIsIndexCreated.mockResolvedValue(false);
      mockQueryItems.mockResolvedValue([]);

      const embedder = makeMockEmbedder();
      embedder.embed.mockResolvedValue([1, 0, 0]);

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const results = await store.search("query", 10);

      expect(results).toEqual([]);
    });
  });
});

describe("VectorStore removeRecipe", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "paprika-vector-store-"));
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  describe("AC4.1: Deletes item from Vectra and removes from hash map", () => {
    it("removes recipe from both Vectra and hash map", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((LocalIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((LocalIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((LocalIndex as any).prototype, "endUpdate");
      const mockDeleteItem = vi.spyOn((LocalIndex as any).prototype, "deleteItem");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);
      mockDeleteItem.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const recipe = makeRecipe({ uid: "recipe-1" });
      await store.indexRecipes([recipe], () => []);

      // Verify recipe is in hash map
      expect(store.size).toBe(1);

      // Remove recipe
      vi.clearAllMocks();
      mockDeleteItem.mockResolvedValue(undefined);
      await store.removeRecipe("recipe-1");

      // Verify Vectra deleteItem was called
      expect(mockDeleteItem).toHaveBeenCalledWith("recipe-1");

      // Verify recipe removed from hash map
      expect(store.size).toBe(0);
    });
  });

  describe("AC4.2: Persists hash map after removal", () => {
    it("writes updated hash-index.json after removal", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((LocalIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((LocalIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((LocalIndex as any).prototype, "endUpdate");
      const mockDeleteItem = vi.spyOn((LocalIndex as any).prototype, "deleteItem");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);
      mockDeleteItem.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      const recipe = makeRecipe({ uid: "recipe-1" });
      await store.indexRecipes([recipe], () => []);

      await store.removeRecipe("recipe-1");

      // Read the persisted hash-index.json
      const hashIndexPath = join(tempDir, "vectors", "hash-index.json");
      const content = await readFile(hashIndexPath, "utf-8");
      const hashes = JSON.parse(content);

      // Verify recipe-1 is not in the persisted map
      expect(hashes).not.toHaveProperty("recipe-1");
    });
  });

  describe("AC4.3: Removing non-existent recipe does not throw", () => {
    it("silently succeeds when removing non-existent uid", async () => {
      const { LocalIndex } = await import("vectra");

      const mockIsIndexCreated = vi.spyOn((LocalIndex as any).prototype, "isIndexCreated");
      const mockDeleteItem = vi.spyOn((LocalIndex as any).prototype, "deleteItem");

      mockIsIndexCreated.mockResolvedValue(false);
      mockDeleteItem.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();

      const store = new VectorStore(tempDir, embedder);
      await store.init();

      // Should not throw
      await expect(store.removeRecipe("nonexistent-uid")).resolves.not.toThrow();

      expect(mockDeleteItem).toHaveBeenCalledWith("nonexistent-uid");
    });
  });
});
