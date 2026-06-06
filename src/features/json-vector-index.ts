/**
 * Minimal local vector index for semantic search.
 *
 * Replaces Vectra's `LocalIndex` for our single use case: storing externally
 * computed embeddings and serving brute-force cosine top-K queries over a
 * personal-scale corpus (hundreds to low-thousands of recipes). Vectra's
 * package barrel eagerly loads its entire stack (gpt-tokenizer, openai, grpc,
 * wink NLP, cheerio, turndown — ~70 MB) even though we only use `LocalIndex`;
 * owning the ~8 methods we actually call drops all of it.
 *
 * On-disk format is a deliberate subset of Vectra's `index.json`
 * (`{ version, items: [{ id, vector, norm, metadata }] }`), so an index written
 * by Vectra loads here without a re-embed migration. Improvements over Vectra:
 *
 * - **Norm is a cache, not source of truth.** Recomputed on every upsert and on
 *   load, so a changed vector can never leave a stale norm behind (a real bug in
 *   Vectra's upsert path that silently corrupts ranking).
 * - **Boundary validation.** Vectors must be non-empty, all-finite, and share a
 *   single dimension; violations are treated as corruption and surface as an
 *   `err` to the caller's recovery path rather than producing `NaN` scores.
 * - **Total comparator.** Non-finite scores (zero-norm items, zero-norm query)
 *   are filtered before ranking, and ties break deterministically by id — never
 *   the `NaN`-poisoned sort Vectra performs.
 * - **Crash-safe persistence.** Write-to-temp + fsync(file) + rename +
 *   fsync(dir), versus Vectra's plain truncating `writeFile`.
 *
 * This is owned code (a from-scratch rewrite of the slice of `vectra` we use,
 * not a vendored copy), so per ADR-0014 its surface returns `Result`: every
 * invariant violation and filesystem failure is an `err`, never a throw.
 */

import { access, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { err, errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";
import { z } from "zod";

import { toMessage } from "../utils/log.js";

/**
 * The index's error type: invariant violations (zero-norm vector, dimension
 * mismatch, transaction misuse), structural corruption found on load, and
 * filesystem failures. Carries the foreign cause where one exists so the
 * `VectorStore` recovery path can log it.
 */
export class VectorIndexError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "VectorIndexError";
  }
}

/** Wrap a foreign (filesystem/parse) rejection into {@link VectorIndexError}. */
function indexError(context: string): (cause: unknown) => VectorIndexError {
  return (cause) => new VectorIndexError(`${context}: ${toMessage(cause)}`, { cause });
}

/**
 * Euclidean (L2) norm of a vector. Caller guarantees finite elements.
 */
export function vectorNorm(vec: ReadonlyArray<number>): number {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) {
    const v = vec[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum);
}

/**
 * Dot product of two equal-length vectors. Length equality is a boundary
 * invariant (enforced on insert/load/query), so this loop trusts it.
 */
export function dotProduct(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i]! * b[i]!;
  }
  return sum;
}

/**
 * Cosine similarity from precomputed norms. Returns `NaN` when either norm is
 * zero — callers MUST filter non-finite scores before ranking (see `queryItems`).
 */
export function cosineScore(
  queryVec: ReadonlyArray<number>,
  queryNorm: number,
  itemVec: ReadonlyArray<number>,
  itemNorm: number,
): number {
  if (queryNorm === 0 || itemNorm === 0) {
    return NaN;
  }
  return dotProduct(queryVec, itemVec) / (queryNorm * itemNorm);
}

/** A stored vector with its precomputed (cached) norm and opaque metadata. */
export type IndexItem = {
  readonly id: string;
  readonly vector: ReadonlyArray<number>;
  readonly norm: number;
  readonly metadata: Record<string, unknown>;
};

/** An item to insert or replace. `norm` is computed internally, not supplied. */
export type UpsertItem = {
  readonly id: string;
  readonly vector: ReadonlyArray<number>;
  readonly metadata?: Record<string, unknown>;
};

/** A single ranked search result: the matched item and its cosine score. */
export type QueryResult = {
  readonly item: { readonly id: string; readonly metadata: Record<string, unknown> };
  readonly score: number;
};

/** Options accepted by `createIndex`, mirroring the subset Vectra exposes. */
export type CreateIndexConfig = {
  readonly version?: number;
  readonly deleteIfExists?: boolean;
};

const ItemSchema = z.object({
  id: z.string(),
  vector: z.array(z.number()),
  // Persisted but always recomputed on load — tolerated if absent (e.g. an
  // index hand-built or written by a future format).
  norm: z.number().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

// `.passthrough()` ignores extra top-level keys (notably Vectra's
// `metadata_config`), which is what makes an existing Vectra index.json load
// unchanged.
const IndexFileSchema = z
  .object({
    version: z.number().int().optional(),
    items: z.array(ItemSchema),
  })
  .passthrough();

type IndexData = { version: number; items: Array<IndexItem> };

const INDEX_FILE = "index.json";

/**
 * File-backed vector index with an explicit begin/commit/cancel transaction and
 * brute-force cosine search. Not safe for concurrent writers on its own — the
 * owning `VectorStore` serializes all mutations through an async-mutex.
 */
export class JsonVectorIndex {
  private readonly _folderPath: string;
  private readonly _indexPath: string;
  // Committed, durable state (loaded lazily). `_update` is the in-flight clone.
  private _data: IndexData | undefined;
  private _update: IndexData | undefined;
  // Dimension all vectors must share; learned from the first inserted/loaded
  // vector, then enforced. `undefined` means "empty index, not yet pinned".
  private _dimension: number | undefined;

  constructor(folderPath: string) {
    this._folderPath = folderPath;
    this._indexPath = join(folderPath, INDEX_FILE);
  }

  /** True if an index file exists on disk (does not validate its contents). */
  async isIndexCreated(): Promise<boolean> {
    try {
      await access(this._indexPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create an empty index file. Errs if one already exists unless
   * `deleteIfExists` is set, in which case the existing file is removed first.
   */
  createIndex(config: CreateIndexConfig = {}): ResultAsync<void, VectorIndexError> {
    return ResultAsync.fromSafePromise(this.isIndexCreated()).andThen((created) => {
      if (created && !config.deleteIfExists) {
        return errAsync(new VectorIndexError("Index already exists"));
      }
      const remove = created
        ? ResultAsync.fromPromise(rm(this._indexPath, { force: true }), indexError("remove existing index"))
        : okAsync<void, VectorIndexError>(undefined);
      const data: IndexData = { version: config.version ?? 1, items: [] };
      return remove
        .andThen(() =>
          ResultAsync.fromPromise(mkdir(this._folderPath, { recursive: true }), indexError("create index dir")),
        )
        .andThen(() => this._persist(data))
        .map(() => {
          this._data = data;
          this._dimension = undefined;
        });
    });
  }

  /**
   * Load the index into memory if not already loaded. Validates every vector
   * (non-empty, all-finite, single shared dimension) and recomputes norms from
   * the vectors, discarding any persisted norm. Errs on a missing or
   * structurally invalid file so the caller can trigger corruption recovery.
   */
  loadIndexData(): ResultAsync<void, VectorIndexError> {
    if (this._data) {
      return okAsync(undefined);
    }
    return ResultAsync.fromPromise(readFile(this._indexPath, "utf-8"), indexError("read index"))
      .andThen((raw) => Result.fromThrowable(() => IndexFileSchema.parse(JSON.parse(raw)), indexError("parse index"))())
      .andThen((parsed) => {
        let dimension: number | undefined;
        const items: Array<IndexItem> = [];
        for (const item of parsed.items) {
          const stepErr = this._validateVector(item.vector, dimension)
            .andThen(() => {
              const norm = vectorNorm(item.vector); // recompute — never trust the persisted value
              // Reject zero-norm vectors as corruption (same bar as insert). This upholds
              // the "every stored item has a positive norm" invariant that lets queryItems
              // skip a per-item finite-score check.
              if (norm === 0) {
                return err(new VectorIndexError(`Index contains a zero-norm vector for id ${item.id}`));
              }
              return ok(norm);
            })
            .match(
              (norm) => {
                dimension ??= item.vector.length;
                items.push({ id: item.id, vector: item.vector, norm, metadata: item.metadata });
                return undefined;
              },
              (e) => e,
            );
          if (stepErr !== undefined) return err(stepErr);
        }
        this._data = { version: parsed.version ?? 1, items };
        this._dimension = dimension;
        return ok(undefined);
      });
  }

  /**
   * Begin a transaction: snapshot committed state so changes can be rolled back.
   *
   * A *shallow* copy of the items array is enough — `_addToUpdate` and
   * `_removeFromUpdate` only replace or remove array slots, never mutate an item
   * object in place (and `IndexItem` is `readonly`). So `_update` and `_data`
   * share the (large, immutable) vector arrays by reference until commit, instead
   * of deep-cloning every vector on every transaction.
   */
  beginUpdate(): ResultAsync<void, VectorIndexError> {
    if (this._update) {
      return errAsync(new VectorIndexError("Update already in progress"));
    }
    return this.loadIndexData().map(() => {
      this._update = { version: this._data!.version, items: [...this._data!.items] };
    });
  }

  /** Discard the in-flight transaction without persisting. */
  cancelUpdate(): void {
    this._update = undefined;
  }

  /**
   * Commit the in-flight transaction: persist durably FIRST, then swap the live
   * in-memory state. A failed write errs with committed state untouched, so a
   * reader never sees a half-applied update and the caller can `cancelUpdate()`.
   */
  endUpdate(): ResultAsync<void, VectorIndexError> {
    const update = this._update;
    if (!update) {
      return errAsync(new VectorIndexError("No update in progress"));
    }
    return this._persist(update).map(() => {
      this._data = update;
      this._update = undefined;
      // Promote the dimension from the now-committed data (undefined when empty).
      // Doing it here — not during `_addToUpdate` — keeps `_dimension` in sync with
      // `_data`, so a rolled-back transaction can't leave it pinned.
      this._dimension = this._data.items[0]?.vector.length;
    });
  }

  /**
   * Insert or replace an item by id. Recomputes the norm from the supplied
   * vector. Runs inside the active transaction, or opens a one-shot transaction
   * if none is in progress (mirroring Vectra's auto-transaction convenience).
   */
  upsertItem(item: UpsertItem): ResultAsync<void, VectorIndexError> {
    if (this._update) {
      return okAsync<void, VectorIndexError>(undefined).andThen(() => this._addToUpdate(item));
    }
    return this.beginUpdate()
      .andThen(() => this._addToUpdate(item))
      .andThen(() => this.endUpdate())
      .orElse((e) => {
        this.cancelUpdate();
        return errAsync(e);
      });
  }

  /** Remove an item by id. No-op if absent. Auto-transacts like `upsertItem`. */
  deleteItem(id: string): ResultAsync<void, VectorIndexError> {
    if (this._update) {
      this._removeFromUpdate(id);
      return okAsync(undefined);
    }
    return this.beginUpdate()
      .andThen(() => {
        this._removeFromUpdate(id);
        return this.endUpdate();
      })
      .orElse((e) => {
        this.cancelUpdate();
        return errAsync(e);
      });
  }

  /**
   * Resolve with the `topK` items most similar to `vector` by cosine score,
   * highest first. Non-finite scores (a zero-norm item, or a zero-norm query)
   * are filtered out rather than allowed to poison the ranking, and ties break
   * deterministically by id. A zero-norm query therefore yields no results.
   *
   * `minScore` (optional) drops results below a cosine cutoff *before* the
   * top-K slice, so a query with few genuine matches returns only those rather
   * than padding the list with near-zero-similarity noise.
   */
  queryItems(
    vector: ReadonlyArray<number>,
    topK: number,
    minScore?: number,
  ): ResultAsync<Array<QueryResult>, VectorIndexError> {
    return this.loadIndexData().andThen(() => {
      if (topK <= 0) {
        return ok<Array<QueryResult>, VectorIndexError>([]);
      }
      return this._validateVector(vector, this._dimension).map(() => {
        const queryNorm = vectorNorm(vector);
        // A score is non-finite only when a norm is zero. Stored items are guaranteed
        // positive-norm (rejected at insert and on load), so the sole remaining source
        // is a zero-norm query — guard it once here rather than per item in the loop.
        if (queryNorm === 0) {
          return [];
        }

        const scored: Array<{ item: IndexItem; score: number }> = [];
        for (const item of this._data!.items) {
          const score = cosineScore(vector, queryNorm, item.vector, item.norm);
          if (minScore === undefined || score >= minScore) {
            scored.push({ item, score });
          }
        }

        scored.sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));

        return scored.slice(0, topK).map((s) => ({
          item: { id: s.item.id, metadata: s.item.metadata },
          score: s.score,
        }));
      });
    });
  }

  private _addToUpdate(item: UpsertItem): Result<void, VectorIndexError> {
    // Enforce a single dimension within the transaction without pinning the
    // committed `_dimension`: validate against the committed dimension, or — for
    // a still-empty index — the first item already staged in THIS transaction.
    // `_dimension` is promoted from committed data only in `endUpdate`, so a
    // cancelled or failed transaction never leaves it pinned to data that was
    // never committed.
    const expectedDim = this._dimension ?? this._update!.items[0]?.vector.length;
    return this._validateVector(item.vector, expectedDim).andThen(() => {
      const norm = vectorNorm(item.vector);
      if (norm === 0) {
        return err(new VectorIndexError(`Refusing to index zero-norm vector for id ${item.id}`));
      }
      const next: IndexItem = {
        id: item.id,
        vector: item.vector,
        norm,
        metadata: item.metadata ?? {},
      };
      const items = this._update!.items;
      const existing = items.findIndex((i) => i.id === item.id);
      if (existing >= 0) {
        items[existing] = next;
      } else {
        items.push(next);
      }
      return ok(undefined);
    });
  }

  private _removeFromUpdate(id: string): void {
    const items = this._update!.items;
    const index = items.findIndex((i) => i.id === id);
    if (index >= 0) {
      items.splice(index, 1);
    }
  }

  /**
   * Reject vectors that would produce NaN scores or break the single-dimension
   * invariant: empty, non-finite elements, or a length that disagrees with the
   * dimension the index has already pinned.
   */
  private _validateVector(vec: ReadonlyArray<number>, expectedDim: number | undefined): Result<void, VectorIndexError> {
    if (vec.length === 0) {
      return err(new VectorIndexError("Vector must be non-empty"));
    }
    if (expectedDim !== undefined && vec.length !== expectedDim) {
      return err(
        new VectorIndexError(
          `Vector dimension ${vec.length.toString()} does not match index dimension ${expectedDim.toString()}`,
        ),
      );
    }
    for (let i = 0; i < vec.length; i++) {
      if (!Number.isFinite(vec[i]!)) {
        return err(new VectorIndexError(`Vector contains non-finite value at index ${i.toString()}`));
      }
    }
    return ok(undefined);
  }

  /**
   * Durably write the index: temp file in the same directory, fsync it, rename
   * over the target, then fsync the directory so the rename itself survives a
   * crash. The temp name is unique per write to avoid colliding with a
   * concurrent (mutex-serialized, but defensive) writer. The async body uses no
   * `throw` of its own — foreign rejections funnel through the single
   * `fromPromise` edge.
   */
  private _persist(data: IndexData): ResultAsync<void, VectorIndexError> {
    const write = async (): Promise<void> => {
      const tmpPath = join(this._folderPath, `.${INDEX_FILE}-${process.pid.toString()}-${Date.now().toString()}.tmp`);
      const fh = await open(tmpPath, "w");
      try {
        await fh.writeFile(JSON.stringify(data));
        await fh.sync();
      } finally {
        await fh.close();
      }
      await rename(tmpPath, this._indexPath);
      await this._fsyncDir(dirname(this._indexPath));
    };
    return ResultAsync.fromPromise(write(), indexError("persist index"));
  }

  /**
   * fsync a directory so a rename within it is durable. Best-effort: the data
   * file is already renamed into place by the time this runs, and some
   * filesystems reject opening/fsync-ing a directory fd — so a failure here must
   * not propagate and undo the committed write (it would leave in-memory state
   * stale while the new index is already on disk).
   */
  private async _fsyncDir(dir: string): Promise<void> {
    try {
      const dh = await open(dir, "r");
      try {
        await dh.sync();
      } finally {
        await dh.close();
      }
    } catch {
      // Directory fsync unsupported on this filesystem; the rename already landed.
    }
  }
}
