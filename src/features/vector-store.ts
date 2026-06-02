/**
 * Vector store implementation for semantic search.
 *
 * Provides recipe-aware vector operations with:
 * - Embedding lifecycle management (when/what to embed)
 * - Vector storage via the vendored `JsonVectorIndex`
 * - Change detection via persisted content hash map
 * - Corruption recovery for both the vector index and hash map
 */

import { createHash } from "node:crypto";

/**
 * Semantic search result from the vector store.
 *
 * Includes the recipe UID, similarity score (0-1), and recipe name for display.
 */
export type SemanticResult = {
  readonly uid: RecipeUid;
  readonly score: number;
  readonly recipeName: string;
};

/**
 * Result of a batch indexing operation.
 *
 * Tracks how many recipes were indexed (content changed), skipped (unchanged),
 * and the total count for reference.
 */
export type IndexingResult = {
  readonly indexed: number;
  readonly skipped: number;
  readonly total: number;
};

/**
 * Produce a stable SHA-256 hex digest of the given text.
 *
 * Used to detect whether a recipe's embeddable fields have changed
 * since the last indexing run. The input text is typically the output
 * of `recipeToEmbeddingText()`, which includes only fields that should
 * trigger re-embedding (name, description, categories, ingredients, notes)
 * and excludes fields like directions and nutritional info that don't
 * affect semantic search relevance.
 *
 * @param text The text to hash (typically embedding text)
 * @returns A stable SHA-256 hex digest
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

import { mkdir, readFile, rename, cp, open } from "node:fs/promises";
import { join } from "node:path";
import { Mutex } from "async-mutex";
import { z } from "zod";
import { JsonVectorIndex } from "./json-vector-index.js";
import type { EmbeddingClient } from "./embeddings.js";
import { recipeToEmbeddingText } from "./embeddings.js";
import { VectorStoreError } from "./vector-store-errors.js";
import type { Logger } from "pino";
import type { CategoryUid, RecipeUid } from "../ids.js";
import type { Recipe } from "../recipe/types.js";
import { SILENT_LOG } from "../utils/log.js";
import { isNodeError } from "../utils/errors.js";

const HashIndexSchema = z.record(z.string(), z.string());

/** Maximum number of texts to embed in a single batch call. */
const BATCH_SIZE = 500;

const VectorMetaSchema = z.object({
  model: z.string(),
  schemaVersion: z.number().int().optional(),
});
type VectorMeta = z.infer<typeof VectorMetaSchema>;

export class VectorStore {
  private readonly _vectorsDir: string;
  private readonly _hashIndexPath: string;
  private readonly _metaPath: string;
  private readonly _index: JsonVectorIndex;
  private readonly _embedder: EmbeddingClient;
  private readonly _modelId: string;
  private readonly _schemaVersion: number;
  private readonly log: Logger;
  private _hashes: Record<string, string> = {};
  // Serializes index mutations. The vector store is a process-wide singleton with
  // multiple concurrent writers — the sync engine fires sync:complete (recipe)
  // and sync:category-change handlers from one syncOnce() without awaiting them,
  // and they both write here. The index's beginUpdate()/endUpdate() is a single
  // transaction (a second beginUpdate while one is open throws), and `_hashes` +
  // its persisted file are shared state, so every write runs exclusively (#177).
  private readonly _writeMutex = new Mutex();

  constructor(cacheDir: string, embedder: EmbeddingClient, modelId: string, schemaVersion: number, log?: Logger) {
    this._vectorsDir = join(cacheDir, "vectors");
    this._hashIndexPath = join(this._vectorsDir, "hash-index.json");
    this._metaPath = join(this._vectorsDir, "vector-meta.json");
    this._index = new JsonVectorIndex(this._vectorsDir);
    this._embedder = embedder;
    this._modelId = modelId;
    this._schemaVersion = schemaVersion;
    this.log = log ?? SILENT_LOG;
  }

  async init(): Promise<void> {
    await mkdir(this._vectorsDir, { recursive: true });

    // Create or open the vector index, with corruption recovery (AC1.4). An
    // existing index is eagerly loaded+validated here (non-finite vectors,
    // ragged dimensions, unparseable JSON all throw) so corruption is repaired
    // at startup rather than surfacing later during a reconcile.
    try {
      const created = await this._index.isIndexCreated();
      if (created) {
        await this._index.loadIndexData();
      } else {
        await this._index.createIndex();
      }
    } catch {
      this.log.warn({ vectorsDir: this._vectorsDir }, "corrupt vector index, backing up and recreating");
      const backupDir = `${this._vectorsDir}.bak`;
      await cp(this._vectorsDir, backupDir, { recursive: true, force: true });
      await this._index.createIndex({ version: 1, deleteIfExists: true });
      this._hashes = {};
      // Persist the cleared hash map so it matches the now-empty index on disk.
      // Without this, a restart before the first successful re-index would reload
      // the stale hash-index.json against the empty index, and indexRecipes would
      // skip every "unchanged" recipe — leaving the index permanently empty.
      await this._persistHashes();
      return; // Skip loading the (just-cleared) hash index — everything is reset
    }

    // Load hash map — follows DiskCache pattern (disk-cache.ts:60-88)
    await this._loadHashIndex();

    // Invalidate vectors when the embedding model or schema version changes.
    // Clearing only the hash map is not enough: a new model may emit a different
    // vector dimension, and the index pins its dimension from the still-present
    // old vectors — so every re-embed upsert (and every search) would throw a
    // dimension mismatch and deadlock re-indexing. Recreate the index so its
    // dimension un-pins and the stale-dimension vectors are dropped.
    const meta = await this._loadMeta();
    if (meta !== null) {
      const modelChanged = meta.model !== this._modelId;
      const schemaChanged = (meta.schemaVersion ?? 0) !== this._schemaVersion;
      if (modelChanged) {
        this.log.info(
          { previousModel: meta.model, newModel: this._modelId },
          "embedding model changed, clearing vector index",
        );
      } else if (schemaChanged) {
        this.log.info(
          { previousSchemaVersion: meta.schemaVersion ?? 0, newSchemaVersion: this._schemaVersion },
          "embedding schema version changed, clearing vector index",
        );
      }
      if (modelChanged || schemaChanged) {
        this._hashes = {};
        await this._index.createIndex({ version: 1, deleteIfExists: true });
      }
    }
  }

  private async _loadHashIndex(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this._hashIndexPath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        // Cold-start: hash-index.json doesn't exist yet. Silent by design.
        this._hashes = {};
        return;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      this.log.warn({ err, path: this._hashIndexPath }, "corrupt hash-index.json, backing up and resetting");
      await this._backupFile(this._hashIndexPath, `${this._hashIndexPath}.bak`);
      this._hashes = {};
      return;
    }

    const result = HashIndexSchema.safeParse(parsed);
    if (!result.success) {
      this.log.warn({ path: this._hashIndexPath }, "schema mismatch on hash-index.json, backing up and resetting");
      await this._backupFile(this._hashIndexPath, `${this._hashIndexPath}.bak`);
      this._hashes = {};
      return;
    }

    this._hashes = result.data;
  }

  private async _loadMeta(): Promise<VectorMeta | null> {
    let raw: string;
    try {
      raw = await readFile(this._metaPath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        // Cold-start: vector-meta.json doesn't exist yet. Silent by design.
        return null;
      }
      throw error;
    }

    try {
      return VectorMetaSchema.parse(JSON.parse(raw));
    } catch (err) {
      this.log.debug({ err, path: this._metaPath }, "could not parse vector-meta.json; will re-detect model/schema");
      return null;
    }
  }

  private async _persistMeta(): Promise<void> {
    const tmpPath = join(this._vectorsDir, `.vector-meta-${Date.now().toString()}.tmp`);
    const fh = await open(tmpPath, "w");
    try {
      await fh.writeFile(JSON.stringify({ model: this._modelId, schemaVersion: this._schemaVersion }));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmpPath, this._metaPath);
  }

  private async _backupFile(src: string, dest: string): Promise<void> {
    try {
      await rename(src, dest);
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      // Idempotent removal: file already gone is the desired end state.
    }
  }

  async indexRecipes(
    recipes: ReadonlyArray<Recipe>,
    resolveCats: (uids: ReadonlyArray<CategoryUid>) => ReadonlyArray<string>,
  ): Promise<IndexingResult> {
    // Run exclusively so a concurrent indexRecipes/removeRecipe can't open an
    // overlapping vector-index transaction or race the hash map (see `_writeMutex`).
    return this._writeMutex.runExclusive(() => this._indexRecipesLocked(recipes, resolveCats));
  }

  private async _indexRecipesLocked(
    recipes: ReadonlyArray<Recipe>,
    resolveCats: (uids: ReadonlyArray<CategoryUid>) => ReadonlyArray<string>,
  ): Promise<IndexingResult> {
    if (recipes.length === 0) {
      return { indexed: 0, skipped: 0, total: 0 };
    }

    // Compute embedding texts and hashes, filter unchanged
    const toEmbed: Array<{ recipe: Recipe; text: string; hash: string }> = [];
    let skipped = 0;

    for (const recipe of recipes) {
      const cats = resolveCats(recipe.categories);
      const text = recipeToEmbeddingText(recipe, cats);
      const hash = contentHash(text);

      if (this._hashes[recipe.uid] === hash) {
        skipped++;
        continue;
      }

      toEmbed.push({ recipe, text, hash });
    }

    if (toEmbed.length === 0) {
      return { indexed: 0, skipped, total: recipes.length };
    }

    // Batch embed in chunks of BATCH_SIZE to avoid API limits on large collections
    const allVectors: Array<Array<number>> = [];
    for (let offset = 0; offset < toEmbed.length; offset += BATCH_SIZE) {
      const chunk = toEmbed.slice(offset, offset + BATCH_SIZE);
      const vectors = await this._embedder.embedBatch(chunk.map((e) => e.text));
      allVectors.push(...vectors);
    }

    // Upsert into the vector index. A single recipe whose embedding is degenerate
    // — all-zero or non-finite, both of which the index rejects — must not abort
    // the whole batch and stall every other recipe, so skip+warn it here rather
    // than letting upsertItem throw. A skipped recipe records no hash, so a
    // transient bad embedding self-heals on the next sync cycle.
    await this._index.beginUpdate();
    const committed: typeof toEmbed = [];
    try {
      for (let i = 0; i < toEmbed.length; i++) {
        const entry = toEmbed[i]!;
        const vector = allVectors[i]!;
        if (!vector.every(Number.isFinite) || vector.every((v) => v === 0)) {
          this.log.warn({ uid: entry.recipe.uid }, "skipping recipe whose embedding is zero or non-finite");
          continue;
        }
        await this._index.upsertItem({
          id: entry.recipe.uid,
          vector,
          metadata: { recipeName: entry.recipe.name },
        });
        committed.push(entry);
      }
      await this._index.endUpdate();
    } catch (error: unknown) {
      this._index.cancelUpdate();
      throw new VectorStoreError("Failed to upsert items into vector index", {
        cause: error instanceof Error ? error : undefined,
      });
    }

    // Update hash map and model metadata — only for recipes actually indexed.
    for (const entry of committed) {
      this._hashes[entry.recipe.uid] = entry.hash;
    }
    await this._persistHashes();
    await this._persistMeta();

    return { indexed: committed.length, skipped, total: recipes.length };
  }

  async indexRecipe(recipe: Readonly<Recipe>, categoryNames: ReadonlyArray<string>): Promise<IndexingResult> {
    return this.indexRecipes([recipe], () => [...categoryNames]);
  }

  get size(): number {
    return Object.keys(this._hashes).length;
  }

  /**
   * Reset the in-memory hash index so that the next `indexRecipes()` call
   * re-embeds every recipe regardless of prior state.  The stale on-disk
   * hash file is overwritten once indexing persists the new hashes.
   */
  clearHashes(): void {
    this._hashes = {};
  }

  private async _persistHashes(): Promise<void> {
    const tmpPath = join(this._vectorsDir, `.hash-index-${Date.now().toString()}.tmp`);
    const fh = await open(tmpPath, "w");
    try {
      await fh.writeFile(JSON.stringify(this._hashes, null, 2));
      await fh.sync();
    } finally {
      await fh.close();
    }
    await rename(tmpPath, this._hashIndexPath);
  }

  async search(query: string, topK: number = 10, minScore?: number): Promise<ReadonlyArray<SemanticResult>> {
    const vector = await this._embedder.embed(query);
    const results = await this._index.queryItems(vector, topK, minScore);
    // The vector index is generic over string ids; every id here was written from
    // `recipe.uid` (see `upsertItem`), so minting `RecipeUid` at this boundary is
    // sound and lets `SemanticResult` carry the brand to callers.
    return results.map((r) => ({
      uid: r.item.id as RecipeUid,
      score: r.score,
      recipeName: (r.item.metadata?.["recipeName"] as string) ?? "",
    }));
  }

  async removeRecipe(uid: string): Promise<void> {
    // Exclusive: shares the vector index + hash map with indexRecipes.
    await this._writeMutex.runExclusive(async () => {
      await this._index.deleteItem(uid);
      if (uid in this._hashes) {
        delete this._hashes[uid];
        await this._persistHashes();
      }
    });
  }
}
