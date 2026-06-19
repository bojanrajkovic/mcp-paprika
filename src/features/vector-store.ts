/**
 * Vector store implementation for semantic search.
 *
 * Provides recipe-aware vector operations with:
 * - Embedding lifecycle management (when/what to embed)
 * - Vector storage via the owned `JsonVectorIndex`
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

import { trace } from "@opentelemetry/api";
import { Mutex } from "async-mutex";
import { err, errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";
import type { Logger } from "pino";
import { z } from "zod";

import type { CategoryUid, RecipeUid } from "../domains/recipe/ids.js";
import type { Recipe } from "../domains/recipe/types.js";
import type { EmbeddingClient, EmbeddingFailure } from "./embeddings.js";

import { getMeter, getTracer, lazy } from "../telemetry/scope.js";
import { traceResultAsync } from "../telemetry/trace-result.js";
import { isNodeError } from "../utils/errors.js";
import { SILENT_LOG, toMessage } from "../utils/log.js";
import { recipeToEmbeddingText } from "./embeddings.js";

/** Re-index latency, every path: startup reconcile, recipe-changed, category-changed, tool writes. */
const reindexDuration = lazy(() =>
  getMeter().createHistogram("mcp_paprika.reindex.duration", {
    description: "Duration of vector-index re-index batches",
    unit: "s",
  }),
);

/** Indexed-recipe count — drift against the recipe store signals a stalled re-index path. */
const vectorIndexSize = lazy(() =>
  getMeter().createObservableGauge("mcp_paprika.vector_index.size", {
    description: "Recipes currently held in the vector index",
    unit: "{recipe}",
  }),
);

import { JsonVectorIndex } from "./json-vector-index.js";
import { VectorStoreError } from "./vector-store-errors.js";

/**
 * The store's public error union: an embedding-provider failure
 * passes through (callers report it as a provider issue — a tripped breaker, a
 * permanent API error), while index and filesystem failures wrap as
 * `VectorStoreError` at this layer.
 */
export type VectorStoreFailure = VectorStoreError | EmbeddingFailure;

/** Wrap a foreign or index-layer failure into {@link VectorStoreError}. */
function storeError(context: string): (cause: unknown) => VectorStoreError {
  return (cause) =>
    new VectorStoreError(`${context}: ${toMessage(cause)}`, {
      cause: cause instanceof Error ? cause : undefined,
    });
}

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
  // transaction (a second beginUpdate while one is open errs), and `_hashes` +
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
    // Collection-time only; the store is a process-wide singleton in production
    // (extra test instances just add benign duplicate observations).
    vectorIndexSize().addCallback((result) => {
      result.observe(this.size);
    });
  }

  init(): ResultAsync<void, VectorStoreError> {
    // Create or open the vector index, with corruption recovery (AC1.4). An
    // existing index is eagerly loaded+validated (non-finite vectors, ragged
    // dimensions, unparseable JSON all err) so corruption is repaired at
    // startup rather than surfacing later during a reconcile. A recovered
    // (recreated) index skips the hash/meta load — everything was just reset.
    return ResultAsync.fromPromise(mkdir(this._vectorsDir, { recursive: true }), storeError("create vectors dir"))
      .andThen(() =>
        // The probe is fromPromise (not fromSafePromise) so even an unexpected
        // probe rejection routes into the corruption-recovery path below.
        ResultAsync.fromPromise(this._index.isIndexCreated(), storeError("probe index"))
          .andThen((created) => (created ? this._index.loadIndexData() : this._index.createIndex()))
          .map(() => "loaded" as const)
          .orElse((cause) => this._recoverCorruptIndex(cause).map(() => "recovered" as const)),
      )
      .andThen((state) => (state === "recovered" ? okAsync<void, VectorStoreError>(undefined) : this._postLoad()));
  }

  /** Back up the corrupt vectors dir, recreate an empty index, reset the hash map. */
  private _recoverCorruptIndex(cause: unknown): ResultAsync<void, VectorStoreError> {
    this.log.warn({ err: cause, vectorsDir: this._vectorsDir }, "corrupt vector index, backing up and recreating");
    const backupDir = `${this._vectorsDir}.bak`;
    return ResultAsync.fromPromise(
      cp(this._vectorsDir, backupDir, { recursive: true, force: true }),
      storeError("back up vectors dir"),
    )
      .andThen(() => this._index.createIndex({ version: 1, deleteIfExists: true }).mapErr(storeError("recreate index")))
      .andThen(() => {
        this._hashes = {};
        // Persist the cleared hash map so it matches the now-empty index on disk.
        // Without this, a restart before the first successful re-index would reload
        // the stale hash-index.json against the empty index, and indexRecipes would
        // skip every "unchanged" recipe — leaving the index permanently empty.
        return this._persistHashes();
      });
  }

  /** Load the hash map, then invalidate everything on a model/schema change. */
  private _postLoad(): ResultAsync<void, VectorStoreError> {
    return this._loadHashIndex()
      .andThen(() => this._loadMeta())
      .andThen((meta) => {
        // Invalidate vectors when the embedding model or schema version changes.
        // Clearing only the hash map is not enough: a new model may emit a different
        // vector dimension, and the index pins its dimension from the still-present
        // old vectors — so every re-embed upsert (and every search) would err with a
        // dimension mismatch and deadlock re-indexing. Recreate the index so its
        // dimension un-pins and the stale-dimension vectors are dropped.
        if (meta === null) return okAsync<void, VectorStoreError>(undefined);
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
          return this._index.createIndex({ version: 1, deleteIfExists: true }).mapErr(storeError("recreate index"));
        }
        return okAsync<void, VectorStoreError>(undefined);
      });
  }

  private _loadHashIndex(): ResultAsync<void, VectorStoreError> {
    return ResultAsync.fromPromise(readFile(this._hashIndexPath, "utf-8"), (e) => e)
      .map((raw): string | null => raw)
      .orElse((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          // Cold-start: hash-index.json doesn't exist yet. Silent by design.
          this._hashes = {};
          return okAsync<string | null, VectorStoreError>(null);
        }
        return errAsync(storeError("read hash-index.json")(error));
      })
      .andThen((raw) => {
        if (raw === null) return okAsync<void, VectorStoreError>(undefined);
        return Result.fromThrowable(
          () => JSON.parse(raw) as unknown,
          (e) => e,
        )().match(
          (parsed) => {
            const result = HashIndexSchema.safeParse(parsed);
            if (!result.success) {
              this.log.warn(
                { path: this._hashIndexPath },
                "schema mismatch on hash-index.json, backing up and resetting",
              );
              return this._backupFile(this._hashIndexPath, `${this._hashIndexPath}.bak`).map(() => {
                this._hashes = {};
              });
            }
            this._hashes = result.data;
            return okAsync<void, VectorStoreError>(undefined);
          },
          (parseErr) => {
            this.log.warn(
              { err: parseErr, path: this._hashIndexPath },
              "corrupt hash-index.json, backing up and resetting",
            );
            return this._backupFile(this._hashIndexPath, `${this._hashIndexPath}.bak`).map(() => {
              this._hashes = {};
            });
          },
        );
      });
  }

  private _loadMeta(): ResultAsync<VectorMeta | null, VectorStoreError> {
    return ResultAsync.fromPromise(readFile(this._metaPath, "utf-8"), (e) => e)
      .map((raw): string | null => raw)
      .orElse((error) => {
        if (isNodeError(error) && error.code === "ENOENT") {
          // Cold-start: vector-meta.json doesn't exist yet. Silent by design.
          return okAsync<string | null, VectorStoreError>(null);
        }
        return errAsync(storeError("read vector-meta.json")(error));
      })
      .map((raw) => {
        if (raw === null) return null;
        return Result.fromThrowable(
          () => VectorMetaSchema.parse(JSON.parse(raw)),
          (e) => e,
        )().match(
          (meta) => meta,
          (parseErr) => {
            this.log.debug(
              { err: parseErr, path: this._metaPath },
              "could not parse vector-meta.json; will re-detect model/schema",
            );
            return null;
          },
        );
      });
  }

  private _persistMeta(): ResultAsync<void, VectorStoreError> {
    const write = async (): Promise<void> => {
      const tmpPath = join(this._vectorsDir, `.vector-meta-${Date.now().toString()}.tmp`);
      const fh = await open(tmpPath, "w");
      try {
        await fh.writeFile(JSON.stringify({ model: this._modelId, schemaVersion: this._schemaVersion }));
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmpPath, this._metaPath);
    };
    return ResultAsync.fromPromise(write(), storeError("persist vector-meta.json"));
  }

  private _backupFile(src: string, dest: string): ResultAsync<void, VectorStoreError> {
    return ResultAsync.fromPromise(rename(src, dest), (e) => e).orElse((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        // Idempotent removal: file already gone is the desired end state.
        return okAsync<void, VectorStoreError>(undefined);
      }
      return errAsync(storeError(`back up ${src}`)(error));
    });
  }

  indexRecipes(
    recipes: ReadonlyArray<Recipe>,
    resolveCats: (uids: ReadonlyArray<CategoryUid>) => ReadonlyArray<string>,
  ): ResultAsync<IndexingResult, VectorStoreFailure> {
    // The single re-index chokepoint, so the operation covers every path that
    // feeds it (startup reconcile, recipe-changed, category-changed, tool
    // writes); embedding-batch spans parent under it. Mutex WAIT time is
    // deliberately inside — queueing behind a concurrent re-index IS part of
    // the latency this measures. The duration histogram records failures with
    // error.type too: a wedged embeddings backend must be visible in the
    // metric, not just the span (the index-event dispatch counter can't see
    // async failures).
    return traceResultAsync(
      getTracer(),
      "discover.reindex",
      {
        attributes: { "mcp_paprika.reindex.batch": recipes.length },
        duration: { histogram: reindexDuration },
      },
      () =>
        // Run exclusively so a concurrent indexRecipes/removeRecipe can't open an
        // overlapping vector-index transaction or race the hash map (see `_writeMutex`).
        // fromPromise + flatten keeps the locked body's Result on the rail (the same
        // double-Result shape as DiskCache._locked).
        ResultAsync.fromPromise(
          this._writeMutex.runExclusive(() => this._indexRecipesLocked(recipes, resolveCats)),
          storeError("index recipes"),
        )
          .andThen((r) => r)
          .map((result) => {
            trace.getActiveSpan()?.setAttributes({
              "mcp_paprika.reindex.indexed": result.indexed,
              "mcp_paprika.reindex.skipped": result.skipped,
            });
            return result;
          }),
    );
  }

  private async _indexRecipesLocked(
    recipes: ReadonlyArray<Recipe>,
    resolveCats: (uids: ReadonlyArray<CategoryUid>) => ReadonlyArray<string>,
  ): Promise<Result<IndexingResult, VectorStoreFailure>> {
    if (recipes.length === 0) {
      return ok({ indexed: 0, skipped: 0, total: 0 });
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
      return ok({ indexed: 0, skipped, total: recipes.length });
    }

    // Batch embed in chunks of BATCH_SIZE to avoid API limits on large collections.
    // An embedding failure aborts the whole run before any index mutation — the
    // provider error passes through to the caller untouched.
    const allVectors: Array<Array<number>> = [];
    for (let offset = 0; offset < toEmbed.length; offset += BATCH_SIZE) {
      const chunk = toEmbed.slice(offset, offset + BATCH_SIZE);
      const batchErr = (await this._embedder.embedBatch(chunk.map((e) => e.text))).match(
        (vectors) => {
          allVectors.push(...vectors);
          return undefined;
        },
        (e) => e,
      );
      if (batchErr !== undefined) return err(batchErr);
    }

    // Upsert into the vector index. A single recipe whose embedding is degenerate
    // — all-zero or non-finite, both of which the index rejects — must not abort
    // the whole batch and stall every other recipe, so skip+warn it here rather
    // than handing upsertItem a vector it would err on. A skipped recipe records
    // no hash, so a transient bad embedding self-heals on the next sync cycle.
    const wrapIndexErr = (e: unknown): VectorStoreError =>
      new VectorStoreError("Failed to upsert items into vector index", {
        cause: e instanceof Error ? e : undefined,
      });
    const beginErr = (await this._index.beginUpdate()).match(() => undefined, wrapIndexErr);
    if (beginErr !== undefined) return err(beginErr);

    const committed: typeof toEmbed = [];
    for (let i = 0; i < toEmbed.length; i++) {
      const entry = toEmbed[i]!;
      const vector = allVectors[i]!;
      if (!vector.every(Number.isFinite) || vector.every((v) => v === 0)) {
        this.log.warn({ uid: entry.recipe.uid }, "skipping recipe whose embedding is zero or non-finite");
        continue;
      }
      const upsertErr = (
        await this._index.upsertItem({
          id: entry.recipe.uid,
          vector,
          metadata: { recipeName: entry.recipe.name },
        })
      ).match(() => undefined, wrapIndexErr);
      if (upsertErr !== undefined) {
        this._index.cancelUpdate();
        return err(upsertErr);
      }
      committed.push(entry);
    }
    const endErr = (await this._index.endUpdate()).match(() => undefined, wrapIndexErr);
    if (endErr !== undefined) {
      this._index.cancelUpdate();
      return err(endErr);
    }

    // Update hash map and model metadata — only for recipes actually indexed.
    for (const entry of committed) {
      this._hashes[entry.recipe.uid] = entry.hash;
    }
    return (await this._persistHashes().andThen(() => this._persistMeta())).map(() => ({
      indexed: committed.length,
      skipped,
      total: recipes.length,
    }));
  }

  indexRecipe(
    recipe: Readonly<Recipe>,
    categoryNames: ReadonlyArray<string>,
  ): ResultAsync<IndexingResult, VectorStoreFailure> {
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

  private _persistHashes(): ResultAsync<void, VectorStoreError> {
    const write = async (): Promise<void> => {
      const tmpPath = join(this._vectorsDir, `.hash-index-${Date.now().toString()}.tmp`);
      const fh = await open(tmpPath, "w");
      try {
        await fh.writeFile(JSON.stringify(this._hashes, null, 2));
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmpPath, this._hashIndexPath);
    };
    return ResultAsync.fromPromise(write(), storeError("persist hash-index.json"));
  }

  search(
    query: string,
    topK: number = 10,
    minScore?: number,
  ): ResultAsync<ReadonlyArray<SemanticResult>, VectorStoreFailure> {
    // Child of the discover_recipes tool span via the active context; the
    // query text itself never becomes an attribute (free text stays out of
    // telemetry), only the shape of the search.
    return traceResultAsync(getTracer(), "discover.query", { attributes: { "mcp_paprika.discover.top_k": topK } }, () =>
      this._embedder
        .embed(query)
        .andThen((vector) => this._index.queryItems(vector, topK, minScore).mapErr(storeError("query vector index")))
        .map((results) => {
          trace.getActiveSpan()?.setAttribute("mcp_paprika.discover.result_count", results.length);
          // The vector index is generic over string ids; every id here was written from
          // `recipe.uid` (see `upsertItem`), so minting `RecipeUid` at this boundary is
          // sound and lets `SemanticResult` carry the brand to callers.
          return results.map((r) => ({
            uid: r.item.id as RecipeUid,
            score: r.score,
            recipeName: (r.item.metadata?.["recipeName"] as string) ?? "",
          }));
        }),
    );
  }

  removeRecipe(uid: string): ResultAsync<void, VectorStoreError> {
    // Exclusive: shares the vector index + hash map with indexRecipes.
    return ResultAsync.fromPromise(
      this._writeMutex.runExclusive(() => this._removeRecipeLocked(uid)),
      storeError("remove recipe"),
    ).andThen((r) => r);
  }

  private async _removeRecipeLocked(uid: string): Promise<Result<void, VectorStoreError>> {
    const deleteErr = (await this._index.deleteItem(uid)).match(() => undefined, storeError("delete vector"));
    if (deleteErr !== undefined) return err(deleteErr);
    if (uid in this._hashes) {
      delete this._hashes[uid];
      return await this._persistHashes();
    }
    return ok(undefined);
  }
}
