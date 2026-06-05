import { mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import { Mutex } from "async-mutex";
import type { Logger } from "pino";

import { isNodeError } from "../utils/errors.js";
import { SILENT_LOG } from "../utils/log.js";

// I/O error handling convention throughout this module:
// We use try/catch and check error.code rather than existsSync()-then-read.
// existsSync() is synchronous (blocks the event loop) and introduces a TOCTOU
// race; try/catch handles the file's actual state at I/O time with no race
// window. Non-ENOENT codes (EISDIR, EACCES, …) are rethrown so unexpected
// errors are never silently swallowed.

/** Open + write + fsync + close — one atomic durable write per call. */
export async function writeFileAtomic(path: string, contents: string): Promise<void> {
  const fh = await open(path, "w");
  try {
    await fh.writeFile(contents);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

export interface DiskCacheOptions<T> {
  readonly subdir: string;
  /**
   * Validates a raw JSON value read from disk and returns a typed `T`.
   * Wraps the Zod schema's `parse` to sidestep Zod's branded-type input
   * variance (the schema input is `string`, the output is `string & BRAND`,
   * which can't be expressed through a single `ZodType<T>` parameter).
   */
  readonly parse: (raw: unknown) => T;
  readonly getKey: (item: T) => string;
  readonly log?: Logger;
}

/**
 * The entity-specific half of {@link DiskCacheOptions}: the subdir name
 * (relative to the cache root), the `parse` function, and the key extractor —
 * everything needed to build a plain `DiskCache<T>` except the cache root and
 * the logger, which the owning module's `.self` factory supplies. Each Paprika
 * entity co-locates its descriptor in `<entity>/disk.ts`; entities whose disk
 * cache needs extra behavior (recipes' hash index, OAuth clients' atomic cap)
 * subclass `DiskCache` directly instead of describing it.
 */
export interface DiskCacheDescriptor<T> {
  /** Subdirectory name under the cache root — not a full path. */
  readonly subdir: string;
  readonly parse: (raw: unknown) => T;
  readonly getKey: (item: T) => string;
}

export class DiskCache<T> {
  protected readonly _subdir: string;
  protected readonly _parse: (raw: unknown) => T;
  protected readonly _getKey: (item: T) => string;
  protected readonly _pending: Map<string, T> = new Map();
  // In-memory mirror of "what keys have a .json file on disk for this entity."
  // Populated from readdir at init() and maintained by put()/remove(). For
  // non-hashed entities this is the complete index — the recipes subclass
  // additionally tracks a UID → hash map for diffing.
  protected readonly _knownKeys: Set<string> = new Set();
  protected readonly _mutex: Mutex = new Mutex();
  protected readonly log: Logger;
  protected _initialized = false;

  constructor(opts: DiskCacheOptions<T>) {
    this._subdir = opts.subdir;
    this._parse = opts.parse;
    this._getKey = opts.getKey;
    this.log = opts.log ?? SILENT_LOG;
  }

  async init(): Promise<void> {
    await mkdir(this._subdir, { recursive: true });
    let files: Array<string>;
    try {
      files = await readdir(this._subdir);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        this._initialized = true;
        return;
      }
      throw error;
    }
    for (const f of files) {
      // Skip the per-entity index file (only RecipeDiskCache writes one). All
      // other data files are <key>.json; the recipes index is the lone
      // exception, kept inside the entity's subdir to keep migration simple.
      if (f === "index.json") continue;
      if (f.endsWith(".json")) {
        this._knownKeys.add(f.slice(0, -5));
      }
    }
    this._initialized = true;
  }

  async flush(): Promise<void> {
    return this._mutex.runExclusive(() => {
      this._assertInitialized("flush");
      return this._writePending();
    });
  }

  async get(key: string): Promise<T | null> {
    this._assertInitialized("get");
    const hit = this._pending.get(key);
    if (hit !== undefined) return hit;

    const filePath = join(this._subdir, `${key}.json`);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf-8");
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        // Cold-start cache miss; silent by design.
        return null;
      }
      throw error;
    }
    return this._parse(JSON.parse(raw));
  }

  async getAll(): Promise<Array<T>> {
    this._assertInitialized("getAll");
    // Pending entries shadow disk; seed result with the buffer.
    const result: Map<string, T> = new Map(this._pending);

    // Read the directory live, not from `_knownKeys`. A second cache
    // instance pointing at the same dir can have written new files we
    // haven't observed yet; tests and operator-side seeding both rely on
    // this. The DCR cap middleware in particular reads `oauthClients.getAll()`
    // on every POST /register and must see externally-seeded files.
    let files: Array<string>;
    try {
      files = await readdir(this._subdir);
    } catch (error: unknown) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [...result.values()];
      }
      throw error;
    }

    await Promise.all(
      files.map(async (filename) => {
        if (!filename.endsWith(".json") || filename === "index.json") return;
        const key = filename.slice(0, -5);
        if (result.has(key)) return;
        const raw = await readFile(join(this._subdir, filename), "utf-8");
        result.set(key, this._parse(JSON.parse(raw)));
      }),
    );

    return [...result.values()];
  }

  async put(item: T): Promise<void> {
    return this._mutex.runExclusive(() => {
      this._assertInitialized("put");
      this._putInner(item);
    });
  }

  async remove(key: string): Promise<void> {
    return this._mutex.runExclusive(async () => {
      this._assertInitialized("remove");
      await this._removeInner(key);
    });
  }

  /**
   * Mutex-free buffer write. Subclasses call this from their own `put`
   * overrides (which already hold the mutex) to extend the put with extra
   * bookkeeping like a hash map without recursively locking.
   */
  protected _putInner(item: T): void {
    const key = this._getKey(item);
    this._pending.set(key, item);
    this._knownKeys.add(key);
  }

  /**
   * Mutex-free remove. Subclasses call this from their own `remove`
   * overrides. ENOENT on unlink is idempotent — the file already being
   * gone is the desired end state.
   */
  protected async _removeInner(key: string): Promise<void> {
    const filePath = join(this._subdir, `${key}.json`);
    try {
      await unlink(filePath);
    } catch (error: unknown) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    this._pending.delete(key);
    this._knownKeys.delete(key);
  }

  has(key: string): boolean {
    return this._knownKeys.has(key);
  }

  get size(): number {
    return this._knownKeys.size;
  }

  /**
   * Template-method hook: write pending entries to disk inside the mutex.
   * Subclasses override to add post-write work (e.g. recipes writes its
   * hash index after the data files are durable). Must NOT re-acquire the
   * mutex — the caller (`flush()`) already holds it.
   */
  protected async _writePending(): Promise<void> {
    if (this._pending.size === 0) return;
    const entries = [...this._pending.entries()];
    await Promise.all(
      entries.map(async ([key, item]) => {
        await this._writeFileAtomic(join(this._subdir, `${key}.json`), JSON.stringify(item, null, 2));
      }),
    );
    this._pending.clear();
  }

  protected async _writeFileAtomic(path: string, contents: string): Promise<void> {
    return writeFileAtomic(path, contents);
  }

  protected _assertInitialized(method: string): void {
    if (!this._initialized) {
      throw new Error(`DiskCache: ${method}() called before init()`);
    }
  }
}
