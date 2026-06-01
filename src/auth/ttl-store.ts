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
 * Optional entry cap (`maxEntries`) bounds memory: once the store holds that many
 * live entries, `put` rejects new keys (after first sweeping expired ones to
 * reclaim slots) rather than evicting an existing entry. Rejecting protects
 * in-flight entries — an attacker flooding the store cannot evict a legitimate
 * auth that is mid-flow, only have its own brand-new write refused.
 *
 * Clock injection (`now`) is available for testing.
 */

export class TtlStore<T extends { createdAt: number }> {
  protected readonly _entries: Map<string, T> = new Map();
  protected readonly _ttlMs: number;
  protected readonly _now: () => number;
  protected readonly _maxEntries: number | undefined;

  /**
   * @param opts.ttlMs - TTL in milliseconds (required; subclasses provide the default)
   * @param opts.now - Clock function returning milliseconds (default: Date.now)
   * @param opts.maxEntries - Hard cap on live entries (default: unbounded)
   */
  constructor(opts: { readonly ttlMs: number; readonly now?: () => number; readonly maxEntries?: number }) {
    this._ttlMs = opts.ttlMs;
    this._now = opts.now ?? Date.now;
    this._maxEntries = opts.maxEntries;
  }

  /**
   * Store a value keyed by `key`.
   *
   * Returns `true` if stored, `false` if rejected because the store is full of
   * live (unexpired) entries. Overwriting an existing key never counts against
   * the cap. When at capacity for a NEW key, expired entries are swept first to
   * reclaim slots before deciding to reject.
   */
  put(key: string, value: T): boolean {
    if (this._maxEntries !== undefined && !this._entries.has(key) && this._entries.size >= this._maxEntries) {
      this.sweepExpired();
      if (this._entries.size >= this._maxEntries) return false;
    }
    this._entries.set(key, value);
    return true;
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
