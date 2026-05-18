/**
 * In-memory TTL store for OAuth 2.1 post-callback state (authorization code).
 *
 * Keyed by `our_auth_code` (our unique authorization code). Default TTL: 60 seconds.
 * Consume-on-read: calling `consume()` atomically deletes the entry for single-use replay protection.
 * Lazy TTL eviction: expired entries are deleted on `consume()`, `peek()`, or `sweepExpired()`.
 *
 * Identity is populated by the `/oauth/callback` handler (Phase 6) after verifying the
 * upstream id_token and checking the allowlist. The store does not enrich; it stores
 * whatever is handed to `put()`.
 *
 * No persistence across restart (in-memory only). Auth codes do NOT survive process restart,
 * which aligns with OAuth 2.1 short-lived code semantics and prevents code-reuse across restarts.
 */

import type { AuthCodeState } from "./types.js";
import { AUTH_CODE_TTL_SECONDS } from "./tokens.js";

export class AuthCodeStore {
  private readonly _entries: Map<string, AuthCodeState> = new Map();
  private readonly _ttlMs: number;
  private readonly _now: () => number;

  /**
   * Constructor with optional TTL and clock injection for testing.
   *
   * @param opts.ttlMs - TTL in milliseconds (default: AUTH_CODE_TTL_SECONDS * 1000)
   * @param opts.now - Clock function returning milliseconds (default: Date.now)
   */
  constructor(opts?: { readonly ttlMs?: number; readonly now?: () => number }) {
    this._ttlMs = opts?.ttlMs ?? AUTH_CODE_TTL_SECONDS * 1000;
    this._now = opts?.now ?? Date.now;
  }

  /**
   * Store an authorization code state keyed by our_auth_code.
   */
  put(authCode: string, state: AuthCodeState): void {
    this._entries.set(authCode, state);
  }

  /**
   * Retrieve and consume (delete) an authorization code state.
   *
   * Consuming is atomic: on successful read, the entry is deleted.
   * Re-reading the same key returns null (single-use enforcement).
   *
   * TTL check: if entry.createdAt + ttl < now, entry is considered expired
   * and deleted. Returns null for expired entries.
   *
   * @param authCode - The authorization code to consume
   * @returns The AuthCodeState, or null if not found or expired
   */
  consume(authCode: string): AuthCodeState | null {
    const entry = this._entries.get(authCode);
    if (entry === undefined) return null;

    // Delete immediately (consume-on-read)
    this._entries.delete(authCode);

    // Check TTL: entry.createdAt is in seconds, _ttlMs is in milliseconds, _now() is in milliseconds
    const expiresAt = entry.createdAt + this._ttlMs / 1000;
    const now = Math.floor(this._now() / 1000);
    if (expiresAt < now) {
      return null; // expired
    }

    return entry;
  }

  /**
   * Retrieve WITHOUT consuming an authorization code state.
   *
   * Used by the provider's challengeForAuthorizationCode which runs BEFORE
   * exchangeAuthorizationCode in the same /token request. The actual consume
   * happens later in exchangeAuthorizationCode.
   *
   * Still evicts expired entries on peek (lazy eviction).
   *
   * @param authCode - The authorization code to peek at
   * @returns The AuthCodeState, or null if not found or expired
   */
  peek(authCode: string): AuthCodeState | null {
    const entry = this._entries.get(authCode);
    if (entry === undefined) return null;

    // Check TTL: entry.createdAt is in seconds, _ttlMs is in milliseconds, _now() is in milliseconds
    const expiresAt = entry.createdAt + this._ttlMs / 1000;
    const now = Math.floor(this._now() / 1000);
    if (expiresAt < now) {
      // Still evict expired entries on peek
      this._entries.delete(authCode);
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
