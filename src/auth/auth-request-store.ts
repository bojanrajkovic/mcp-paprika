/**
 * In-memory TTL store for OAuth 2.1 pre-callback state (OIDC auth_request).
 *
 * Keyed by `our_state` (CSRF token). Default TTL: 5 minutes.
 * Consume-on-read: calling `consume()` atomically deletes the entry for single-use semantics.
 * Lazy TTL eviction: expired entries are deleted on `consume()` or `sweepExpired()`.
 *
 * No persistence across restart (in-memory only). Not used in normal production cleanup
 * as the entries typically consume within seconds of creation. `sweepExpired()` is called
 * periodically in Phase 7 for memory hygiene.
 */

import type { AuthRequestState } from "./types.js";
import { AUTH_REQUEST_TTL_SECONDS } from "./tokens.js";

export class AuthRequestStore {
  private readonly _entries: Map<string, AuthRequestState> = new Map();
  private readonly _ttlMs: number;
  private readonly _now: () => number;

  /**
   * Constructor with optional TTL and clock injection for testing.
   *
   * @param opts.ttlMs - TTL in milliseconds (default: AUTH_REQUEST_TTL_SECONDS * 1000)
   * @param opts.now - Clock function returning milliseconds (default: Date.now)
   */
  constructor(opts?: { readonly ttlMs?: number; readonly now?: () => number }) {
    this._ttlMs = opts?.ttlMs ?? AUTH_REQUEST_TTL_SECONDS * 1000;
    this._now = opts?.now ?? Date.now;
  }

  /**
   * Store an auth request state keyed by our_state.
   */
  put(ourState: string, state: AuthRequestState): void {
    this._entries.set(ourState, state);
  }

  /**
   * Retrieve and consume (delete) an auth request state.
   *
   * Consuming is atomic: on successful read, the entry is deleted.
   * Re-reading the same key returns null.
   *
   * TTL check: if entry.createdAt + ttl < now, entry is considered expired
   * and deleted. Returns null for expired entries.
   *
   * @param ourState - The state key to consume
   * @returns The AuthRequestState, or null if not found or expired
   */
  consume(ourState: string): AuthRequestState | null {
    const entry = this._entries.get(ourState);
    if (entry === undefined) return null;

    // Delete immediately (consume-on-read)
    this._entries.delete(ourState);

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
