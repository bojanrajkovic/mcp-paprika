/**
 * In-memory TTL store for OAuth 2.1 pre-callback state (OIDC auth_request).
 *
 * Keyed by `our_state` (CSRF token). Default TTL: 5 minutes.
 * Consume-on-read: calling `consume()` atomically deletes the entry for single-use semantics.
 * Lazy TTL eviction: expired entries are deleted on `consume()` or `sweepExpired()`.
 *
 * No persistence across restart (in-memory only). Not used in normal production cleanup
 * as the entries typically consume within seconds of creation. `sweepExpired()` is called
 * periodically by `AuthCleanup` for memory hygiene.
 */

import type { AuthRequestState } from "./types.js";

import { AUTH_REQUEST_TTL_SECONDS, MAX_INMEMORY_AUTH_ENTRIES } from "./tokens.js";
import { TtlStore } from "./ttl-store.js";

export class AuthRequestStore extends TtlStore<AuthRequestState> {
  /**
   * Constructor with optional TTL and clock injection for testing.
   *
   * @param opts.ttlMs - TTL in milliseconds (default: AUTH_REQUEST_TTL_SECONDS * 1000)
   * @param opts.now - Clock function returning milliseconds (default: Date.now)
   * @param opts.maxEntries - Entry cap (default: MAX_INMEMORY_AUTH_ENTRIES)
   */
  constructor(opts?: { readonly ttlMs?: number; readonly now?: () => number; readonly maxEntries?: number }) {
    super({
      ttlMs: opts?.ttlMs ?? AUTH_REQUEST_TTL_SECONDS * 1000,
      maxEntries: opts?.maxEntries ?? MAX_INMEMORY_AUTH_ENTRIES,
      ...(opts?.now !== undefined ? { now: opts.now } : {}),
    });
  }
}
