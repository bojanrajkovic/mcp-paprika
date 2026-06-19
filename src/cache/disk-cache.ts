import { mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";

import { Mutex } from "async-mutex";
import { err, errAsync, ok, okAsync, Result, ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import { getMeter, lazy, startTimer } from "../telemetry/scope.js";
import { isNodeError } from "../utils/errors.js";
import { SILENT_LOG } from "../utils/log.js";

// Persistence-layer metrics at the two aggregate chokepoints: flush (the
// fsync-heavy per-cycle durability cost) and getAll (boot hydration + the DCR
// cap reads). Entity = the subdir's basename — the flat on-disk names
// ("recipes", "pantry", …), a closed low-cardinality set. Per-item get/put
// deliberately unmeasured: their cost aggregates into flush.
const cacheOperationDuration = lazy(() =>
  getMeter().createHistogram("mcp_paprika.cache.operation.duration", {
    description: "Duration of disk-cache flush and getAll operations",
    unit: "s",
  }),
);
const cacheErrors = lazy(() =>
  getMeter().createCounter("mcp_paprika.cache.errors", {
    description: "Disk-cache operations that surfaced a CacheError (recovered ENOENTs excluded)",
    unit: "{error}",
  }),
);

// I/O error handling convention throughout this module:
// Every filesystem call is converted to a `Result` at this edge:
// `ResultAsync.fromPromise` wraps the foreign promise, and ENOENT-tolerant paths
// recover via `.orElse` on the error's `cause` code rather than an
// existsSync()-then-read dance. existsSync() is synchronous (blocks the event
// loop) and introduces a TOCTOU race; reading the error code reflects the file's
// actual state at I/O time with no race window. Non-ENOENT codes (EISDIR,
// EACCES, …) surface as `err` so unexpected failures are never silently
// swallowed.

/**
 * A failed cache operation: where it happened (`context`), a human-readable
 * `message` for tool responses and logs, and the foreign `cause` (usually the
 * Node fs error) for structured logging.
 */
export interface CacheError {
  readonly context: string;
  readonly message: string;
  readonly cause: unknown;
}

/** Build a `CacheError` mapper for `ResultAsync.fromPromise` at one call site. */
export function cacheError(context: string): (cause: unknown) => CacheError {
  return (cause) => ({
    context,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });
}

/**
 * `.orElse` recovery for ENOENT-tolerant paths: a missing file/directory is a
 * normal cold-start or idempotent-delete case and recovers to `recovery`; any
 * other code stays an `err`.
 */
export const enoentOk =
  <T>(recovery: T) =>
  (e: CacheError): ResultAsync<T, CacheError> =>
    isNodeError(e.cause) && e.cause.code === "ENOENT" ? okAsync(recovery) : errAsync(e);

/** Open + write + fsync + close — one atomic durable write per call. */
export function writeFileAtomic(path: string, contents: string): ResultAsync<void, CacheError> {
  return ResultAsync.fromPromise(
    (async (): Promise<void> => {
      const fh = await open(path, "w");
      try {
        await fh.writeFile(contents);
        await fh.sync();
      } finally {
        await fh.close();
      }
    })(),
    cacheError(`write ${path}`),
  );
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
 * the logger, which the owning module's `.state` factory supplies. Each Paprika
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

  /** Metric entity label — the flat on-disk name; invariant, so computed once. */
  private readonly _entity: string;

  constructor(opts: DiskCacheOptions<T>) {
    this._subdir = opts.subdir;
    this._parse = opts.parse;
    this._getKey = opts.getKey;
    this.log = opts.log ?? SILENT_LOG;
    this._entity = basename(this._subdir);
  }

  init(): ResultAsync<void, CacheError> {
    return ResultAsync.fromPromise(mkdir(this._subdir, { recursive: true }), cacheError(`init mkdir ${this._subdir}`))
      .andThen(() => this._readdirOrEmpty("init"))
      .map((files) => {
        for (const f of files) {
          // Skip the per-entity index file (only RecipeDiskCache writes one). All
          // other data files are <key>.json; the recipes index is the lone
          // non-per-key file living inside an entity subdir.
          if (f === "index.json") continue;
          if (f.endsWith(".json")) {
            this._knownKeys.add(f.slice(0, -5));
          }
        }
        this._initialized = true;
      });
  }

  flush(): ResultAsync<void, CacheError> {
    return this._measured("flush", () => this._locked("flush", () => this._writePending()));
  }

  /**
   * Record the operation histogram on ok and the error counter on err; values
   * pass through untouched. Takes a THUNK so the timer starts before the
   * operation does — an eagerly-built ResultAsync is already running (mutex
   * acquisition included) by the time it could be passed in, which would
   * undercount exactly the contended case the histogram exists to expose.
   */
  private _measured<V>(op: string, run: () => ResultAsync<V, CacheError>): ResultAsync<V, CacheError> {
    const elapsedSeconds = startTimer();
    return run()
      .map((value) => {
        cacheOperationDuration().record(elapsedSeconds(), {
          "mcp_paprika.cache.entity": this._entity,
          "mcp_paprika.cache.op": op,
        });
        return value;
      })
      .mapErr((error) => {
        cacheErrors().add(1, { "mcp_paprika.cache.entity": this._entity, "mcp_paprika.cache.op": op });
        return error;
      });
  }

  get(key: string): ResultAsync<T | null, CacheError> {
    return this._requireInit("get").asyncAndThen(() => {
      const hit = this._pending.get(key);
      if (hit !== undefined) return okAsync<T | null, CacheError>(hit);

      const filePath = join(this._subdir, `${key}.json`);
      return ResultAsync.fromPromise(readFile(filePath, "utf-8"), cacheError(`get ${filePath}`))
        .orElse(enoentOk<string | null>(null)) // Cold-start cache miss; silent by design.
        .andThen((raw): Result<T | null, CacheError> => (raw === null ? ok(null) : this._parseRaw(raw, filePath)));
    });
  }

  getAll(): ResultAsync<Array<T>, CacheError> {
    return this._measured("get_all", () => this._getAllInner());
  }

  private _getAllInner(): ResultAsync<Array<T>, CacheError> {
    return this._requireInit("getAll").asyncAndThen(() => {
      // Pending entries shadow disk; seed result with the buffer.
      const result: Map<string, T> = new Map(this._pending);

      // Read the directory live, not from `_knownKeys`. A second cache
      // instance pointing at the same dir can have written new files we
      // haven't observed yet; tests and operator-side seeding both rely on
      // this. The DCR cap middleware in particular reads `oauthClients.getAll()`
      // on every POST /register and must see externally-seeded files.
      return this._readdirOrEmpty("getAll").andThen((files) => {
        const reads = files
          .filter((filename) => filename.endsWith(".json") && filename !== "index.json")
          .map((filename) => ({ filename, key: filename.slice(0, -5) }))
          .filter(({ key }) => !result.has(key))
          .map(({ filename, key }) => {
            const filePath = join(this._subdir, filename);
            return ResultAsync.fromPromise(readFile(filePath, "utf-8"), cacheError(`getAll ${filePath}`))
              .andThen((raw) => this._parseRaw(raw, filePath))
              .map((item) => {
                result.set(key, item);
              });
          });
        return ResultAsync.combine(reads).map(() => [...result.values()]);
      });
    });
  }

  put(item: T): ResultAsync<void, CacheError> {
    return this._locked("put", () => {
      this._putInner(item);
      return okAsync<void, CacheError>(undefined);
    });
  }

  remove(key: string): ResultAsync<void, CacheError> {
    return this._locked("remove", () => this._removeInner(key));
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
  protected _removeInner(key: string): ResultAsync<void, CacheError> {
    const filePath = join(this._subdir, `${key}.json`);
    return ResultAsync.fromPromise(unlink(filePath), cacheError(`remove ${filePath}`))
      .orElse(enoentOk<void>(undefined))
      .map(() => {
        this._pending.delete(key);
        this._knownKeys.delete(key);
      });
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
  protected _writePending(): ResultAsync<void, CacheError> {
    if (this._pending.size === 0) return okAsync(undefined);
    const entries = [...this._pending.entries()];
    return ResultAsync.combine(
      entries.map(([key, item]) =>
        this._writeFileAtomic(join(this._subdir, `${key}.json`), JSON.stringify(item, null, 2)),
      ),
    ).map(() => {
      this._pending.clear();
    });
  }

  protected _writeFileAtomic(path: string, contents: string): ResultAsync<void, CacheError> {
    return writeFileAtomic(path, contents);
  }

  /** List the entity subdir, treating a missing directory as empty (cold start). */
  protected _readdirOrEmpty(context: string): ResultAsync<Array<string>, CacheError> {
    return ResultAsync.fromPromise(readdir(this._subdir), cacheError(`${context} readdir ${this._subdir}`)).orElse(
      enoentOk<Array<string>>([]),
    );
  }

  /** Validate one raw JSON file body; a corrupt or schema-mismatched file is an `err`, as the throw was before. */
  protected _parseRaw(raw: string, path: string): Result<T, CacheError> {
    return Result.fromThrowable(() => this._parse(JSON.parse(raw) as unknown), cacheError(`parse ${path}`))();
  }

  /** Misuse guard: every operation requires a completed `init()`. */
  protected _requireInit(method: string): Result<void, CacheError> {
    if (this._initialized) return ok(undefined);
    const message = `DiskCache: ${method}() called before init()`;
    return err({ context: method, message, cause: undefined });
  }

  /**
   * Run `body` holding the cache mutex, after the init guard. Foreign rejections
   * escaping `body` (a bug, not a modeled failure) still surface as `err` via the
   * outer `fromPromise`, so no caller ever sees a rejection from this class.
   */
  protected _locked<R>(method: string, body: () => ResultAsync<R, CacheError>): ResultAsync<R, CacheError> {
    return ResultAsync.fromPromise(
      this._mutex.runExclusive(
        async (): Promise<Result<R, CacheError>> => this._requireInit(method).asyncAndThen(body),
      ),
      cacheError(method),
    ).andThen((r) => r);
  }
}
