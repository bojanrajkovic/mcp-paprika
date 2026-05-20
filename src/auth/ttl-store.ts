/**
 * Generic in-memory TTL store base class.
 *
 * Keyed by string. Entries must carry a `createdAt` field (Unix epoch seconds).
 * Supports consume-on-read (`consume`), peek-without-consume (`peek` available
 * in subclasses that expose it), and batch eviction (`sweepExpired`).
 *
 * Lazy TTL eviction: expired entries are removed on `consume()` or `sweepExpired()`.
 * Subclasses may implement `peek()` with lazy eviction on the expired branch.
 *
 * TTL semantics: entry is expired when `entry.createdAt + ttlMs/1000 < now` (strict
 * less-than). At exact equality the entry is still valid.
 *
 * Clock injection (`now`) is available for testing.
 */

export class TtlStore<T extends { createdAt: number }> {
  protected readonly _entries: Map<string, T> = new Map();
  protected readonly _ttlMs: number;
  protected readonly _now: () => number;

  /**
   * @param opts.ttlMs - TTL in milliseconds (required; subclasses provide the default)
   * @param opts.now - Clock function returning milliseconds (default: Date.now)
   */
  constructor(opts: { readonly ttlMs: number; readonly now?: () => number }) {
    this._ttlMs = opts.ttlMs;
    this._now = opts.now ?? Date.now;
  }

  /**
   * Store a value keyed by key.
   */
  put(key: string, value: T): void {
    this._entries.set(key, value);
  }

  /**
   * Retrieve and consume (delete) an entry.
   *
   * Consuming is atomic: on successful read, the entry is deleted first,
   * then TTL is checked. Re-reading the same key returns null (single-use
   * enforcement). Expired entries are evicted and null is returned.
   *
   * @returns The entry, or null if not found or expired
   */
  consume(key: string): T | null {
    const entry = this._entries.get(key);
    if (entry === undefined) return null;

    // Delete immediately (consume-on-read)
    this._entries.delete(key);

    // Check TTL: entry.createdAt is in seconds, _ttlMs is in milliseconds, _now() is in milliseconds
    const expiresAt = entry.createdAt + this._ttlMs / 1000;
    const now = Math.floor(this._now() / 1000);
    if (expiresAt < now) {
      return null; // expired
    }

    return entry;
  }

  /**
   * Remove all expired entries from the store.
   *
   * @returns Number of entries removed
   */
  sweepExpired(): number {
    const now = Math.floor(this._now() / 1000);
    let removed = 0;

    for (const [key, entry] of this._entries) {
      const expiresAt = entry.createdAt + this._ttlMs / 1000;
      if (expiresAt < now) {
        this._entries.delete(key);
        removed += 1;
      }
    }

    return removed;
  }

  /**
   * Current number of entries in the store.
   */
  get size(): number {
    return this._entries.size;
  }
}
