/**
 * Minimal local vector index for semantic search.
 *
 * Replaces Vectra's `LocalIndex` for our single use case: storing externally
 * computed embeddings and serving brute-force cosine top-K queries over a
 * personal-scale corpus (hundreds to low-thousands of recipes). Vectra's
 * package barrel eagerly loads its entire stack (gpt-tokenizer, openai, grpc,
 * wink NLP, cheerio, turndown — ~70 MB) even though we only use `LocalIndex`;
 * vendoring the ~8 methods we actually call drops all of it.
 *
 * On-disk format is a deliberate subset of Vectra's `index.json`
 * (`{ version, items: [{ id, vector, norm, metadata }] }`), so an index written
 * by Vectra loads here without a re-embed migration. Improvements over Vectra:
 *
 * - **Norm is a cache, not source of truth.** Recomputed on every upsert and on
 *   load, so a changed vector can never leave a stale norm behind (a real bug in
 *   Vectra's upsert path that silently corrupts ranking).
 * - **Boundary validation.** Vectors must be non-empty, all-finite, and share a
 *   single dimension; violations are treated as corruption and surface to the
 *   caller's recovery path rather than producing `NaN` scores.
 * - **Total comparator.** Non-finite scores (zero-norm items, zero-norm query)
 *   are filtered before ranking, and ties break deterministically by id — never
 *   the `NaN`-poisoned sort Vectra performs.
 * - **Crash-safe persistence.** Write-to-temp + fsync(file) + rename +
 *   fsync(dir), versus Vectra's plain truncating `writeFile`.
 */

import { mkdir, readFile, rename, open, access, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

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
   * Create an empty index file. Throws if one already exists unless
   * `deleteIfExists` is set, in which case the existing file is removed first.
   */
  async createIndex(config: CreateIndexConfig = {}): Promise<void> {
    if (await this.isIndexCreated()) {
      if (!config.deleteIfExists) {
        throw new Error("Index already exists");
      }
      await rm(this._indexPath, { force: true });
    }
    await mkdir(this._folderPath, { recursive: true });
    const data: IndexData = { version: config.version ?? 1, items: [] };
    await this._persist(data);
    this._data = data;
    this._dimension = undefined;
  }

  /**
   * Load the index into memory if not already loaded. Validates every vector
   * (non-empty, all-finite, single shared dimension) and recomputes norms from
   * the vectors, discarding any persisted norm. Throws on a missing or
   * structurally invalid file so the caller can trigger corruption recovery.
   */
  async loadIndexData(): Promise<void> {
    if (this._data) {
      return;
    }
    const raw = await readFile(this._indexPath, "utf-8");
    const parsed = IndexFileSchema.parse(JSON.parse(raw));

    let dimension: number | undefined;
    const items: Array<IndexItem> = [];
    for (const item of parsed.items) {
      this._assertValidVector(item.vector, dimension);
      dimension ??= item.vector.length;
      const norm = vectorNorm(item.vector); // recompute — never trust the persisted value
      // Reject zero-norm vectors as corruption (same bar as insert). This upholds
      // the "every stored item has a positive norm" invariant that lets queryItems
      // skip a per-item finite-score check.
      if (norm === 0) {
        throw new Error(`Index contains a zero-norm vector for id ${item.id}`);
      }
      items.push({ id: item.id, vector: item.vector, norm, metadata: item.metadata });
    }

    this._data = { version: parsed.version ?? 1, items };
    this._dimension = dimension;
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
  async beginUpdate(): Promise<void> {
    if (this._update) {
      throw new Error("Update already in progress");
    }
    await this.loadIndexData();
    this._update = { version: this._data!.version, items: [...this._data!.items] };
  }

  /** Discard the in-flight transaction without persisting. */
  cancelUpdate(): void {
    this._update = undefined;
  }

  /**
   * Commit the in-flight transaction: persist durably FIRST, then swap the live
   * in-memory state. A failed write throws with committed state untouched, so a
   * reader never sees a half-applied update and the caller can `cancelUpdate()`.
   */
  async endUpdate(): Promise<void> {
    if (!this._update) {
      throw new Error("No update in progress");
    }
    await this._persist(this._update);
    this._data = this._update;
    this._update = undefined;
  }

  /**
   * Insert or replace an item by id. Recomputes the norm from the supplied
   * vector. Runs inside the active transaction, or opens a one-shot transaction
   * if none is in progress (mirroring Vectra's auto-transaction convenience).
   */
  async upsertItem(item: UpsertItem): Promise<void> {
    if (this._update) {
      this._addToUpdate(item);
      return;
    }
    await this.beginUpdate();
    try {
      this._addToUpdate(item);
      await this.endUpdate();
    } catch (err) {
      this.cancelUpdate();
      throw err;
    }
  }

  /** Remove an item by id. No-op if absent. Auto-transacts like `upsertItem`. */
  async deleteItem(id: string): Promise<void> {
    if (this._update) {
      this._removeFromUpdate(id);
      return;
    }
    await this.beginUpdate();
    try {
      this._removeFromUpdate(id);
      await this.endUpdate();
    } catch (err) {
      this.cancelUpdate();
      throw err;
    }
  }

  /**
   * Return the `topK` items most similar to `vector` by cosine score, highest
   * first. Non-finite scores (a zero-norm item, or a zero-norm query) are
   * filtered out rather than allowed to poison the ranking, and ties break
   * deterministically by id. A zero-norm query therefore yields no results.
   */
  async queryItems(vector: ReadonlyArray<number>, topK: number): Promise<Array<QueryResult>> {
    await this.loadIndexData();
    if (topK <= 0) {
      return [];
    }
    this._assertValidVector(vector, this._dimension);
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
      scored.push({ item, score });
    }

    scored.sort((a, b) => b.score - a.score || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0));

    return scored.slice(0, topK).map((s) => ({
      item: { id: s.item.id, metadata: s.item.metadata },
      score: s.score,
    }));
  }

  private _addToUpdate(item: UpsertItem): void {
    this._assertValidVector(item.vector, this._dimension);
    const norm = vectorNorm(item.vector);
    if (norm === 0) {
      throw new Error(`Refusing to index zero-norm vector for id ${item.id}`);
    }
    this._dimension ??= item.vector.length;
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
  private _assertValidVector(vec: ReadonlyArray<number>, expectedDim: number | undefined): void {
    if (vec.length === 0) {
      throw new Error("Vector must be non-empty");
    }
    if (expectedDim !== undefined && vec.length !== expectedDim) {
      throw new Error(`Vector dimension ${vec.length} does not match index dimension ${expectedDim}`);
    }
    for (let i = 0; i < vec.length; i++) {
      if (!Number.isFinite(vec[i]!)) {
        throw new Error(`Vector contains non-finite value at index ${i}`);
      }
    }
  }

  /**
   * Durably write the index: temp file in the same directory, fsync it, rename
   * over the target, then fsync the directory so the rename itself survives a
   * crash. The temp name is unique per write to avoid colliding with a
   * concurrent (mutex-serialized, but defensive) writer.
   */
  private async _persist(data: IndexData): Promise<void> {
    // The folder is created by `createIndex` (and by VectorStore.init) before any
    // write, so no per-commit mkdir is needed on the hot path.
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
