/**
 * In-memory TTL store for pending downstream authorizations awaiting consent (#147).
 *
 * Keyed by an opaque single-use consent ticket (`mcp_consent_…`). Default TTL:
 * 10 minutes (`PENDING_AUTHORIZATION_TTL_SECONDS`). Consume-on-read: `consume()`
 * atomically deletes the entry, so a ticket can drive at most one upstream
 * redirect (no replay).
 *
 * No persistence across restart (in-memory only). `sweepExpired()` is called
 * periodically by `AuthCleanup` for memory hygiene; entries normally consume
 * within minutes of creation. Distinct from `auth-request-store.ts`: this holds
 * pre-consent state (before any upstream redirect), whereas AuthRequestStore
 * holds pre-callback state (after the upstream redirect).
 */

import type { PendingAuthorization } from "./types.js";
import { PENDING_AUTHORIZATION_TTL_SECONDS } from "./tokens.js";
import { TtlStore } from "./ttl-store.js";

export class PendingAuthorizationStore extends TtlStore<PendingAuthorization> {
  /**
   * @param opts.ttlMs - TTL in milliseconds (default: PENDING_AUTHORIZATION_TTL_SECONDS * 1000)
   * @param opts.now - Clock function returning milliseconds (default: Date.now)
   */
  constructor(opts?: { readonly ttlMs?: number; readonly now?: () => number }) {
    super({
      ttlMs: opts?.ttlMs ?? PENDING_AUTHORIZATION_TTL_SECONDS * 1000,
      ...(opts?.now !== undefined ? { now: opts.now } : {}),
    });
  }
}
