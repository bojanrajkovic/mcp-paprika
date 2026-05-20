/**
 * In-memory TTL store for OAuth 2.1 post-callback state (authorization code).
 *
 * Keyed by `our_auth_code` (our unique authorization code). Default TTL: 60 seconds.
 * Consume-on-read: calling `consume()` atomically deletes the entry for single-use replay protection.
 * Lazy TTL eviction: expired entries are deleted on `consume()`, `peek()`, or `sweepExpired()`.
 *
 * Identity is populated by the `/oauth/callback` handler after verifying the
 * upstream id_token and checking the allowlist. The store does not enrich; it stores
 * whatever is handed to `put()`.
 *
 * No persistence across restart (in-memory only). Auth codes do NOT survive process restart,
 * which aligns with OAuth 2.1 short-lived code semantics and prevents code-reuse across restarts.
 */

import type { AuthCodeState } from "./types.js";
import { AUTH_CODE_TTL_SECONDS } from "./tokens.js";
import { TtlStore } from "./ttl-store.js";

export class AuthCodeStore extends TtlStore<AuthCodeState> {
  /**
   * Constructor with optional TTL and clock injection for testing.
   *
   * @param opts.ttlMs - TTL in milliseconds (default: AUTH_CODE_TTL_SECONDS * 1000)
   * @param opts.now - Clock function returning milliseconds (default: Date.now)
   */
  constructor(opts?: { readonly ttlMs?: number; readonly now?: () => number }) {
    super({
      ttlMs: opts?.ttlMs ?? AUTH_CODE_TTL_SECONDS * 1000,
      ...(opts?.now !== undefined ? { now: opts.now } : {}),
    });
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
}
