/**
 * A tiny bounded LRU of resized photo JPEGs, scoped to one session's
 * `ui://recipe/{uid}/photo` resource registration. A browse list reads the proxy
 * once per visible row (each a sync GET → presigned-S3 fetch → sharp re-encode), so
 * caching the produced bytes keyed by `${photoHash}:${w}x${h}` lets a re-read (a
 * scroll-back, a re-open) skip the round trip and the encode. The key carries the
 * photo's content hash, so a changed photo never serves stale bytes.
 *
 * Deliberately minimal (a Map with insertion-order eviction): the values are
 * regenerable, so dropping the oldest on overflow is harmless — the opposite of the
 * auth TTL stores, where evicting a live entry is an attack vector.
 */
export class PhotoByteCache {
  private readonly entries = new Map<string, Buffer>();

  constructor(private readonly maxEntries: number) {}

  /** Returns the cached bytes for `key`, bumping it to most-recently-used, or `undefined`. */
  get(key: string): Buffer | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      // Re-insert so the Map's insertion order reflects recency (LRU).
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  /** Stores `value` under `key`, evicting the least-recently-used entries past the cap. */
  set(key: string, value: Buffer): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** Current entry count — for tests/observability. */
  get size(): number {
    return this.entries.size;
  }
}
