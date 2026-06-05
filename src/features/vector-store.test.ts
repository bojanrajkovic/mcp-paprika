import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { fromAny } from "@total-typescript/shoehorn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mocked } from "vitest";

import type { RecipeUid } from "../ids.js";
import type { EmbeddingClient } from "./embeddings.js";

import { makeRecipe } from "../../test/domains/recipe/__fixtures__/recipes.js";
import { useTempDir } from "../../test/support/disk-caches.js";
import { makePinoCapture } from "../../test/support/tool-test-utils.js";
import { recipeToEmbeddingText } from "./embeddings.js";
import { VectorStoreError } from "./vector-store-errors.js";
import { contentHash, VectorStore } from "./vector-store.js";

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

// Mock setup for all init and operation tests. These exercise VectorStore's
// orchestration (corruption recovery, hash map, model/schema invalidation) with
// the underlying index stubbed; json-vector-index.test.ts covers the real index.
vi.mock("./json-vector-index.js", () => {
  const MockIndex = vi.fn();
  MockIndex.prototype.isIndexCreated = vi.fn();
  MockIndex.prototype.createIndex = vi.fn();
  MockIndex.prototype.loadIndexData = vi.fn();
  MockIndex.prototype.beginUpdate = vi.fn();
  MockIndex.prototype.endUpdate = vi.fn();
  MockIndex.prototype.cancelUpdate = vi.fn();
  MockIndex.prototype.upsertItem = vi.fn();
  MockIndex.prototype.deleteItem = vi.fn();
  MockIndex.prototype.queryItems = vi.fn();
  return { JsonVectorIndex: MockIndex };
});

function makeMockEmbedder(): Mocked<EmbeddingClient> {
  return fromAny({
    embed: vi.fn<(text: string) => Promise<Array<number>>>(),
    embedBatch: vi.fn<(texts: ReadonlyArray<string>) => Promise<Array<Array<number>>>>(),
    get dimensions() {
      return 3;
    },
  });
}

describe("VectorStore init", () => {
  const tmp = useTempDir("paprika-vector-store-");

  beforeEach(async () => {
    await tmp.setup();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await tmp.teardown();
    vi.clearAllMocks();
  });

  describe("AC1.1: First run - creates index and empty hash map", () => {
    it("creates the vector index when none exists", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");
      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockCreateIndex = vi.spyOn((JsonVectorIndex as any).prototype, "createIndex");

      mockIsIndexCreated.mockResolvedValue(false);
      mockCreateIndex.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      expect(mockIsIndexCreated).toHaveBeenCalled();
      expect(mockCreateIndex).toHaveBeenCalled();
      expect(store.size).toBe(0);
    });
  });

  describe("AC1.2: Subsequent run - loads existing hash map and opens index", () => {
    it("loads valid hash-index.json and does not recreate index", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockCreateIndex = vi.spyOn((JsonVectorIndex as any).prototype, "createIndex");

      // Write valid hash-index.json before init
      const vectorsDir = join(tmp.dir(), "vectors");
      await mkdir(vectorsDir, { recursive: true });
      const hashIndexPath = join(vectorsDir, "hash-index.json");
      const validIndex = { "recipe-1": "hash-abc", "recipe-2": "hash-def" };
      await writeFile(hashIndexPath, JSON.stringify(validIndex));

      mockIsIndexCreated.mockResolvedValue(true);
      mockCreateIndex.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      // Verify index was already created so createIndex not called
      expect(mockIsIndexCreated).toHaveBeenCalled();
      expect(mockCreateIndex).not.toHaveBeenCalled();
      // Verify hash map was loaded
      expect(store.size).toBe(2);
    });
  });

  describe("AC1.3: Corruption recovery - invalid JSON", () => {
    it("recovers from corrupted hash-index.json (invalid JSON) and emits warn log", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");

      // Write invalid JSON to hash-index.json
      const vectorsDir = join(tmp.dir(), "vectors");
      await mkdir(vectorsDir, { recursive: true });
      const hashIndexPath = join(vectorsDir, "hash-index.json");
      await writeFile(hashIndexPath, "{invalid json");

      mockIsIndexCreated.mockResolvedValue(true);

      const embedder = makeMockEmbedder();
      const { log, records } = makePinoCapture();
      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1, log);
      await store.init();

      // Verify warn record (pino level 40) was emitted with corruption message
      const warnRecords = records.filter((r) => r["level"] === 40);
      expect(warnRecords).toHaveLength(1);
      expect(warnRecords[0]!["msg"]).toBe("corrupt hash-index.json, backing up and resetting");
      expect(warnRecords[0]!).toHaveProperty("path", hashIndexPath);

      // Verify backup was created
      const backupPath = `${hashIndexPath}.bak`;
      const backupContent = await readFile(backupPath, "utf-8");
      expect(backupContent).toBe("{invalid json");

      // Verify store was reset to empty
      expect(store.size).toBe(0);
    });

    it("recovers from corrupted hash-index.json (schema mismatch) and emits warn log", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");

      // Write valid JSON but invalid schema (not a record, but an array)
      const vectorsDir = join(tmp.dir(), "vectors");
      await mkdir(vectorsDir, { recursive: true });
      const hashIndexPath = join(vectorsDir, "hash-index.json");
      await writeFile(hashIndexPath, JSON.stringify(["not", "a", "record"]));

      mockIsIndexCreated.mockResolvedValue(true);

      const embedder = makeMockEmbedder();
      const { log, records } = makePinoCapture();
      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1, log);
      await store.init();

      // Verify warn record (pino level 40) was emitted with schema-mismatch message
      const warnRecords = records.filter((r) => r["level"] === 40);
      expect(warnRecords).toHaveLength(1);
      expect(warnRecords[0]!["msg"]).toBe("schema mismatch on hash-index.json, backing up and resetting");

      // Verify store was reset to empty
      expect(store.size).toBe(0);
    });
  });

  describe("AC1.4: Corruption recovery - corrupted vector index", () => {
    it("recovers from a corrupted vector index by recreating and emits warn log", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockCreateIndex = vi.spyOn((JsonVectorIndex as any).prototype, "createIndex");

      // Simulate corruption by throwing when calling isIndexCreated
      mockIsIndexCreated.mockRejectedValueOnce(new Error("Index corrupted"));
      mockCreateIndex.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      const { log, records } = makePinoCapture();
      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1, log);
      await store.init();

      // Verify warn record (pino level 40) was emitted with corruption message
      const warnRecords = records.filter((r) => r["level"] === 40);
      expect(warnRecords).toHaveLength(1);
      expect(warnRecords[0]!["msg"]).toBe("corrupt vector index, backing up and recreating");

      // Verify hash map was cleared
      expect(store.size).toBe(0);
    });

    it("recovers when an existing index loads as corrupt (loadIndexData throws) at init", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");
      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockLoadIndexData = vi.spyOn((JsonVectorIndex as any).prototype, "loadIndexData");
      const mockCreateIndex = vi.spyOn((JsonVectorIndex as any).prototype, "createIndex");

      // Index file is present, but loading it fails validation (e.g. non-finite
      // vector / ragged dimension) — the new eager load in init() must catch it.
      mockIsIndexCreated.mockResolvedValue(true);
      mockLoadIndexData.mockRejectedValueOnce(new Error("Vector contains non-finite value at index 3"));
      mockCreateIndex.mockResolvedValue(undefined);

      // A stale hash-index.json from before the corruption. Recovery must clear
      // it on disk too, or a restart would reload these hashes against the now-
      // empty index and skip every "unchanged" recipe forever.
      const vectorsDir = join(tmp.dir(), "vectors");
      await mkdir(vectorsDir, { recursive: true });
      const hashIndexPath = join(vectorsDir, "hash-index.json");
      await writeFile(hashIndexPath, JSON.stringify({ "recipe-1": "hash-abc", "recipe-2": "hash-def" }));

      const embedder = makeMockEmbedder();
      const { log, records } = makePinoCapture();
      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1, log);
      await store.init();

      const warnRecords = records.filter((r) => r["level"] === 40);
      expect(warnRecords).toHaveLength(1);
      expect(warnRecords[0]!["msg"]).toBe("corrupt vector index, backing up and recreating");
      expect(mockCreateIndex).toHaveBeenCalledWith({ version: 1, deleteIfExists: true });
      expect(store.size).toBe(0);
      // The on-disk hash file is rewritten to empty (not left stale).
      expect(JSON.parse(await readFile(hashIndexPath, "utf-8"))).toEqual({});
    });
  });

  describe("Model change detection", () => {
    it("clears hashes when stored model differs from current model and emits info log", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");
      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      // First run with model-a: index a recipe (no capture needed for first run)
      const store1 = new VectorStore(tmp.dir(), embedder, "model-a", 1);
      await store1.init();
      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      await store1.indexRecipes([recipe], () => []);
      expect(store1.size).toBe(1);

      // Second run with model-b: should clear hashes and emit info log
      vi.clearAllMocks();
      mockIsIndexCreated.mockResolvedValue(true);
      const { log, records } = makePinoCapture();
      const store2 = new VectorStore(tmp.dir(), embedder, "model-b", 1, log);
      await store2.init();

      expect(store2.size).toBe(0);
      // info level = pino numeric 30
      const infoRecords = records.filter((r) => r["level"] === 30);
      const modelChangedRecord = infoRecords.find((r) => r["msg"] === "embedding model changed, clearing vector index");
      expect(modelChangedRecord).toBeDefined();
      expect(modelChangedRecord!["previousModel"]).toBe("model-a");
      expect(modelChangedRecord!["newModel"]).toBe("model-b");
    });

    it("recreates the index (not just hashes) on model change so a new vector dimension cannot deadlock", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");
      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockCreateIndex = vi.spyOn((JsonVectorIndex as any).prototype, "createIndex");
      vi.spyOn((JsonVectorIndex as any).prototype, "loadIndexData").mockResolvedValue(undefined);

      mockIsIndexCreated.mockResolvedValue(false);
      mockCreateIndex.mockResolvedValue(undefined);
      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      // First run establishes vector-meta.json with model-a.
      const store1 = new VectorStore(tmp.dir(), embedder, "model-a", 1);
      await store1.init();
      await store1.indexRecipes([makeRecipe({ uid: "recipe-1" as RecipeUid })], () => []);

      // Second run with a different model must call createIndex({deleteIfExists})
      // to drop the stale-dimension vectors and un-pin the index dimension.
      vi.clearAllMocks();
      mockIsIndexCreated.mockResolvedValue(true);
      const store2 = new VectorStore(tmp.dir(), embedder, "model-b", 1);
      await store2.init();

      expect(mockCreateIndex).toHaveBeenCalledWith({ version: 1, deleteIfExists: true });
      expect(store2.size).toBe(0);
    });

    it("clears hashes when schema version changes between runs and emits info log", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");
      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      // First run with schema version 1 (no capture for first run)
      const store1 = new VectorStore(tmp.dir(), embedder, "same-model", 1);
      await store1.init();
      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      await store1.indexRecipes([recipe], () => []);
      expect(store1.size).toBe(1);

      // Second run with schema version 2 (embedding text format changed)
      vi.clearAllMocks();
      mockIsIndexCreated.mockResolvedValue(true);
      const { log, records } = makePinoCapture();
      const store2 = new VectorStore(tmp.dir(), embedder, "same-model", 2, log);
      await store2.init();

      expect(store2.size).toBe(0);
      // info level = pino numeric 30
      const infoRecords = records.filter((r) => r["level"] === 30);
      const schemaChangedRecord = infoRecords.find(
        (r) => r["msg"] === "embedding schema version changed, clearing vector index",
      );
      expect(schemaChangedRecord).toBeDefined();
    });

    it("preserves hashes when model is unchanged between runs", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");
      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      // First run
      const store1 = new VectorStore(tmp.dir(), embedder, "same-model", 1);
      await store1.init();
      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      await store1.indexRecipes([recipe], () => []);

      // Second run with same model
      vi.clearAllMocks();
      mockIsIndexCreated.mockResolvedValue(true);
      const store2 = new VectorStore(tmp.dir(), embedder, "same-model", 1);
      await store2.init();

      expect(store2.size).toBe(1);
    });
  });

  describe("AC9.2: Logger injection and cold-start silence", () => {
    it("backward-compat: VectorStore(cacheDir, embedder, modelId, schemaVersion) without log still works", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");
      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockCreateIndex = vi.spyOn((JsonVectorIndex as any).prototype, "createIndex");

      mockIsIndexCreated.mockResolvedValue(false);
      mockCreateIndex.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      // No log argument — defaults to silent logger
      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      expect(store.size).toBe(0);
    });

    it("emits no log records on cold-start when hash-index.json is absent (ENOENT)", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");
      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockCreateIndex = vi.spyOn((JsonVectorIndex as any).prototype, "createIndex");

      mockIsIndexCreated.mockResolvedValue(false);
      mockCreateIndex.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      const { log, records } = makePinoCapture();
      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1, log);
      await store.init();

      // ENOENT on hash-index.json is silent by design (cold-start)
      // Only the normal initialization path runs: no corruption = no records
      expect(records).toHaveLength(0);
    });
  });
});

describe("VectorStore indexRecipes", () => {
  const tmp = useTempDir("paprika-vector-store-");

  beforeEach(async () => {
    await tmp.setup();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await tmp.teardown();
    vi.clearAllMocks();
  });

  describe("AC2.1: Embeds and upserts recipes with changed content hash", () => {
    it("calls embedBatch and upserts items for new recipes", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([
        [1, 0, 0],
        [0, 1, 0],
      ]);

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const recipe1 = makeRecipe({ uid: "recipe-1" as RecipeUid });
      const recipe2 = makeRecipe({ uid: "recipe-2" as RecipeUid });

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

    it("skips a recipe with a degenerate (zero-norm) embedding without aborting the batch", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");
      vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated").mockResolvedValue(false);
      vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate").mockResolvedValue(undefined);
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem").mockResolvedValue(undefined);
      vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate").mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      // Second recipe's embedding is all-zero (degenerate) — must be skipped, not
      // allowed to throw and roll back the good first recipe.
      embedder.embedBatch.mockResolvedValue([
        [1, 0, 0],
        [0, 0, 0],
      ]);

      const { log, records } = makePinoCapture();
      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1, log);
      await store.init();

      const good = makeRecipe({ uid: "recipe-good" as RecipeUid });
      const bad = makeRecipe({ uid: "recipe-bad" as RecipeUid });
      const result = await store.indexRecipes([good, bad], () => []);

      expect(mockUpsertItem).toHaveBeenCalledTimes(1);
      expect(mockUpsertItem).toHaveBeenCalledWith({
        id: "recipe-good",
        vector: [1, 0, 0],
        metadata: { recipeName: good.name },
      });
      expect(result).toEqual({ indexed: 1, skipped: 0, total: 2 });
      // The good recipe is hashed (skipped on a re-run); the bad one is not.
      expect(store.size).toBe(1);
      const warn = records.filter((r) => r["level"] === 40);
      expect(warn).toHaveLength(1);
      expect(warn[0]!["msg"]).toBe("skipping recipe whose embedding is zero or non-finite");
    });
  });

  describe("AC2.2: Skips recipes with unchanged content hash", () => {
    it("skips recipes with matching content hash", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });

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
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const recipe1 = makeRecipe({ uid: "recipe-1" as RecipeUid });

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
      const recipe2 = makeRecipe({ uid: "recipe-2" as RecipeUid });
      const recipe3 = makeRecipe({ uid: "recipe-3" as RecipeUid });

      const result = await store.indexRecipes([recipe1, recipe2, recipe3], () => []);

      expect(result).toEqual({ indexed: 2, skipped: 1, total: 3 });
    });
  });

  describe("AC2.4: Persists hash map after indexing", () => {
    it("writes updated hash-index.json after indexing", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      await store.indexRecipes([recipe], () => []);

      // Read the persisted hash-index.json
      const hashIndexPath = join(tmp.dir(), "vectors", "hash-index.json");
      const content = await readFile(hashIndexPath, "utf-8");
      const hashes = JSON.parse(content);

      expect(hashes).toHaveProperty("recipe-1");
      expect(typeof hashes["recipe-1"]).toBe("string");
    });
  });

  describe("AC2.5: Empty recipe list returns zero counts", () => {
    it("returns { indexed: 0, skipped: 0, total: 0 } and does not call embedBatch", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");

      mockIsIndexCreated.mockResolvedValue(false);

      const embedder = makeMockEmbedder();

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const result = await store.indexRecipes([], () => []);

      expect(embedder.embedBatch).not.toHaveBeenCalled();
      expect(result).toEqual({ indexed: 0, skipped: 0, total: 0 });
    });
  });

  describe("AC2.6: Hash map persists across VectorStore restarts", () => {
    it("loads previously saved hashes and skips unchanged recipes on restart", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      // First store instance
      const store1 = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store1.init();
      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      await store1.indexRecipes([recipe], () => []);

      // Reset mocks for second instance
      vi.clearAllMocks();
      mockIsIndexCreated.mockResolvedValue(true);
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);

      // Create new store instance pointing to the same directory
      const store2 = new VectorStore(tmp.dir(), embedder, "test-model", 1);
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
  const tmp = useTempDir("paprika-vector-store-");

  beforeEach(async () => {
    await tmp.setup();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await tmp.teardown();
    vi.clearAllMocks();
  });

  describe("AC3.1: Embeds query and returns SemanticResult array", () => {
    it("returns results with uid, score, and recipeName", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockQueryItems = vi.spyOn((JsonVectorIndex as any).prototype, "queryItems");

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

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const results = await store.search("pasta recipe", 10);

      expect(embedder.embed).toHaveBeenCalledWith("pasta recipe");
      expect(mockQueryItems).toHaveBeenCalledWith([1, 0, 0], 10, undefined);
      expect(results).toEqual([
        { uid: "recipe-1", score: 0.95, recipeName: "Pasta" },
        { uid: "recipe-2", score: 0.87, recipeName: "Risotto" },
      ]);
    });
  });

  describe("AC3.2: Results are ordered by descending similarity score", () => {
    it("returns results sorted by score descending", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockQueryItems = vi.spyOn((JsonVectorIndex as any).prototype, "queryItems");

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

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const results = await store.search("query", 10);

      expect(results[0]!.score).toBe(0.99);
      expect(results[1]!.score).toBe(0.75);
      expect(results[2]!.score).toBe(0.52);
    });
  });

  describe("AC3.3: Empty index returns empty array", () => {
    it("returns empty array when no results found", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockQueryItems = vi.spyOn((JsonVectorIndex as any).prototype, "queryItems");

      mockIsIndexCreated.mockResolvedValue(false);
      mockQueryItems.mockResolvedValue([]);

      const embedder = makeMockEmbedder();
      embedder.embed.mockResolvedValue([1, 0, 0]);

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const results = await store.search("query", 10);

      expect(results).toEqual([]);
    });
  });
});

describe("VectorStore removeRecipe", () => {
  const tmp = useTempDir("paprika-vector-store-");

  beforeEach(async () => {
    await tmp.setup();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await tmp.teardown();
    vi.clearAllMocks();
  });

  describe("AC4.1: Deletes item from the vector index and removes from hash map", () => {
    it("removes recipe from both the vector index and hash map", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");
      const mockDeleteItem = vi.spyOn((JsonVectorIndex as any).prototype, "deleteItem");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);
      mockDeleteItem.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      await store.indexRecipes([recipe], () => []);

      // Verify recipe is in hash map
      expect(store.size).toBe(1);

      // Remove recipe
      vi.clearAllMocks();
      mockDeleteItem.mockResolvedValue(undefined);
      await store.removeRecipe("recipe-1");

      // Verify the index deleteItem was called
      expect(mockDeleteItem).toHaveBeenCalledWith("recipe-1");

      // Verify recipe removed from hash map
      expect(store.size).toBe(0);
    });
  });

  describe("AC4.2: Persists hash map after removal", () => {
    it("writes updated hash-index.json after removal", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockBeginUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate");
      const mockUpsertItem = vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem");
      const mockEndUpdate = vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate");
      const mockDeleteItem = vi.spyOn((JsonVectorIndex as any).prototype, "deleteItem");

      mockIsIndexCreated.mockResolvedValue(false);
      mockBeginUpdate.mockResolvedValue(undefined);
      mockUpsertItem.mockResolvedValue(undefined);
      mockEndUpdate.mockResolvedValue(undefined);
      mockDeleteItem.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();
      embedder.embedBatch.mockResolvedValue([[1, 0, 0]]);

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      const recipe = makeRecipe({ uid: "recipe-1" as RecipeUid });
      await store.indexRecipes([recipe], () => []);

      await store.removeRecipe("recipe-1");

      // Read the persisted hash-index.json
      const hashIndexPath = join(tmp.dir(), "vectors", "hash-index.json");
      const content = await readFile(hashIndexPath, "utf-8");
      const hashes = JSON.parse(content);

      // Verify recipe-1 is not in the persisted map
      expect(hashes).not.toHaveProperty("recipe-1");
    });
  });

  describe("AC4.3: Removing non-existent recipe does not throw", () => {
    it("silently succeeds when removing non-existent uid", async () => {
      const { JsonVectorIndex } = await import("./json-vector-index.js");

      const mockIsIndexCreated = vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated");
      const mockDeleteItem = vi.spyOn((JsonVectorIndex as any).prototype, "deleteItem");

      mockIsIndexCreated.mockResolvedValue(false);
      mockDeleteItem.mockResolvedValue(undefined);

      const embedder = makeMockEmbedder();

      const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
      await store.init();

      // Should not throw
      await expect(store.removeRecipe("nonexistent-uid")).resolves.not.toThrow();

      expect(mockDeleteItem).toHaveBeenCalledWith("nonexistent-uid");
    });
  });
});

describe("VectorStore write serialization (#177)", () => {
  const tmp = useTempDir("paprika-vector-store-");

  beforeEach(async () => {
    await tmp.setup();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await tmp.teardown();
    vi.clearAllMocks();
  });

  it("serializes overlapping indexRecipes calls so vector-index transactions never overlap", async () => {
    // Two writers (sync:complete recipe handler + sync:category-change handler)
    // can fire from one sync cycle without being awaited. The index's begin/endUpdate
    // is a single transaction — a second beginUpdate while one is open throws.
    // The write mutex must keep that from happening.
    const { JsonVectorIndex } = await import("./json-vector-index.js");
    vi.spyOn((JsonVectorIndex as any).prototype, "isIndexCreated").mockResolvedValue(false);
    vi.spyOn((JsonVectorIndex as any).prototype, "createIndex").mockResolvedValue(undefined);
    vi.spyOn((JsonVectorIndex as any).prototype, "upsertItem").mockResolvedValue(undefined);

    let openTransactions = 0;
    let maxOpen = 0;
    vi.spyOn((JsonVectorIndex as any).prototype, "beginUpdate").mockImplementation(async () => {
      openTransactions++;
      maxOpen = Math.max(maxOpen, openTransactions);
      if (openTransactions > 1) throw new Error("Update already in progress");
    });
    vi.spyOn((JsonVectorIndex as any).prototype, "endUpdate").mockImplementation(async () => {
      openTransactions--;
    });

    const embedder = makeMockEmbedder();
    // Slow embed so the two calls would interleave without the mutex.
    embedder.embedBatch.mockImplementation(async (texts) => {
      await new Promise((r) => setTimeout(r, 10));
      return texts.map(() => [1, 0, 0]);
    });

    const store = new VectorStore(tmp.dir(), embedder, "test-model", 1);
    await store.init();

    const r1 = makeRecipe({ uid: "r1" as RecipeUid });
    const r2 = makeRecipe({ uid: "r2" as RecipeUid });

    // Fire concurrently. Without serialization the second beginUpdate throws and
    // one of these rejects (the handler's catch would then swallow it in prod,
    // dropping that recipe's embedding update).
    const results = await Promise.all([store.indexRecipes([r1], () => []), store.indexRecipes([r2], () => [])]);

    expect(results[0]!.indexed).toBe(1);
    expect(results[1]!.indexed).toBe(1);
    expect(maxOpen).toBe(1); // never two transactions open at once
  });
});
