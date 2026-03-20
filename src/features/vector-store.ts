/**
 * Vector store implementation using Vectra for semantic search.
 *
 * Provides recipe-aware vector operations with:
 * - Embedding lifecycle management (when/what to embed)
 * - Vector storage via Vectra LocalIndex
 * - Change detection via persisted content hash map
 * - Corruption recovery for both Vectra index and hash map
 */

import { createHash } from "node:crypto";

/**
 * Semantic search result from the vector store.
 *
 * Includes the recipe UID, similarity score (0-1), and recipe name for display.
 */
export type SemanticResult = {
  readonly uid: string;
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
import { z } from "zod";
import { LocalIndex } from "vectra";
import type { EmbeddingClient } from "./embeddings.js";
import { recipeToEmbeddingText } from "./embeddings.js";
import { VectorStoreError } from "./vector-store-errors.js";
import type { Recipe, CategoryUid } from "../paprika/types.js";

const HashIndexSchema = z.record(z.string(), z.string());

/** Maximum number of texts to embed in a single batch call. */
const BATCH_SIZE = 500;

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function log(msg: string): void {
  process.stderr.write(`[mcp-paprika:vectors] ${msg}\n`);
}

export class VectorStore {
  private readonly _vectorsDir: string;
  private readonly _hashIndexPath: string;
  private readonly _index: LocalIndex;
  private readonly _embedder: EmbeddingClient;
  private _hashes: Record<string, string> = {};

  constructor(cacheDir: string, embedder: EmbeddingClient) {
    this._vectorsDir = join(cacheDir, "vectors");
    this._hashIndexPath = join(this._vectorsDir, "hash-index.json");
    this._index = new LocalIndex(this._vectorsDir);
    this._embedder = embedder;
  }

  async init(): Promise<void> {
    await mkdir(this._vectorsDir, { recursive: true });

    // Create or open Vectra index, with corruption recovery (AC1.4)
    try {
      const created = await this._index.isIndexCreated();
      if (!created) {
        await this._index.createIndex();
      }
    } catch {
      log("corrupt Vectra index, backing up and recreating");
      const backupDir = `${this._vectorsDir}.bak`;
      await cp(this._vectorsDir, backupDir, { recursive: true, force: true });
      await this._index.createIndex({ version: 1, deleteIfExists: true });
      this._hashes = {};
      return; // Skip loading hash index — just cleared everything
    }

    // Load hash map — follows DiskCache pattern (disk-cache.ts:60-88)
    await this._loadHashIndex();
  }

  private async _loadHashIndex(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this._hashIndexPath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this._hashes = {};
        return;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log("corrupt hash-index.json (invalid JSON), backing up and resetting");
      await this._backupFile(this._hashIndexPath, `${this._hashIndexPath}.bak`);
      this._hashes = {};
      return;
    }

    const result = HashIndexSchema.safeParse(parsed);
    if (!result.success) {
      log("corrupt hash-index.json (schema mismatch), backing up and resetting");
      await this._backupFile(this._hashIndexPath, `${this._hashIndexPath}.bak`);
      this._hashes = {};
      return;
    }

    this._hashes = result.data;
  }

  private async _backupFile(src: string, dest: string): Promise<void> {
    try {
      await rename(src, dest);
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }

  async indexRecipes(
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

    // Upsert into Vectra
    await this._index.beginUpdate();
    try {
      for (let i = 0; i < toEmbed.length; i++) {
        const entry = toEmbed[i]!;
        await this._index.upsertItem({
          id: entry.recipe.uid,
          vector: allVectors[i]!,
          metadata: { recipeName: entry.recipe.name },
        });
      }
      await this._index.endUpdate();
    } catch (error: unknown) {
      this._index.cancelUpdate();
      throw new VectorStoreError("Failed to upsert items into vector index", {
        cause: error instanceof Error ? error : undefined,
      });
    }

    // Update hash map
    for (const entry of toEmbed) {
      this._hashes[entry.recipe.uid] = entry.hash;
    }
    await this._persistHashes();

    return { indexed: toEmbed.length, skipped, total: recipes.length };
  }

  async indexRecipe(recipe: Readonly<Recipe>, categoryNames: ReadonlyArray<string>): Promise<IndexingResult> {
    return this.indexRecipes([recipe], () => [...categoryNames]);
  }

  get size(): number {
    return Object.keys(this._hashes).length;
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

  async search(query: string, topK: number = 10): Promise<ReadonlyArray<SemanticResult>> {
    const vector = await this._embedder.embed(query);
    const results = await this._index.queryItems(vector, topK);
    return results.map((r) => ({
      uid: r.item.id,
      score: r.score,
      recipeName: (r.item.metadata?.["recipeName"] as string) ?? "",
    }));
  }

  async removeRecipe(uid: string): Promise<void> {
    await this._index.deleteItem(uid);
    if (uid in this._hashes) {
      delete this._hashes[uid];
      await this._persistHashes();
    }
  }
}
