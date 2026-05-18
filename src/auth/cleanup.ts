/**
 * AuthCleanup — background maintenance task for OAuth 2.1 state hygiene.
 *
 * Mirrors SyncEngine's lifecycle (src/paprika/sync.ts): idempotent start/stop,
 * AbortController-gated _loop(), never-throws semantics.
 *
 * Responsibilities (run every CLEANUP_INTERVAL_MS = 6h):
 * 1. Remove stale DCR clients (lastTokenActivityAt > 90 days old) + cascade their tokens.
 * 2. Sweep expired in-memory AuthRequestStore and AuthCodeStore entries.
 *
 * Public `sweepOnce()` is exposed for direct testing and for startup use.
 */

import { setTimeout as wait } from "node:timers/promises";
import type { DiskCache } from "../cache/disk-cache.js";
import type { AuthRequestStore } from "./auth-request-store.js";
import type { AuthCodeStore } from "./auth-code-store.js";
import type { DiskClientRegistrationStore } from "./client-registration.js";
import type { TokenStore } from "./token-store.js";
import { DCR_CLIENT_STALE_DAYS } from "./tokens.js";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class AuthCleanup {
  private _ac: AbortController | null = null;

  constructor(
    private readonly _clientStore: DiskClientRegistrationStore,
    private readonly _tokenStore: TokenStore,
    private readonly _cache: DiskCache,
    private readonly _authRequests: AuthRequestStore,
    private readonly _authCodes: AuthCodeStore,
    private readonly _now: () => number = () => Math.floor(Date.now() / 1000),
    private readonly _intervalMs: number = CLEANUP_INTERVAL_MS,
  ) {}

  /** Start the background cleanup loop. Idempotent — second call is a no-op. */
  start(): void {
    if (this._ac !== null) return;
    this._ac = new AbortController();
    void this._loop().catch(() => {});
  }

  /** Stop the background cleanup loop. Idempotent — second call is a no-op. */
  stop(): void {
    if (this._ac === null) return;
    this._ac.abort();
    this._ac = null;
  }

  /**
   * Run one cleanup sweep.
   *
   * Public for tests and for direct use from startup code (e.g., buildAuth).
   * May throw on disk errors (DiskCache/TokenStore/DiskClientRegistrationStore
   * failures propagate to the caller). The background loop (`_loop`) catches
   * these and continues — callers invoking `sweepOnce` directly should handle
   * rejection.
   *
   * Returns counts of removed entries for observability.
   */
  async sweepOnce(): Promise<{
    clientsRemoved: number;
    tokensRemoved: number;
    authRequestsRemoved: number;
    authCodesRemoved: number;
  }> {
    // (1) Stale DCR clients: lastTokenActivityAt older than DCR_CLIENT_STALE_DAYS (90d)
    const cutoff = this._now() - DCR_CLIENT_STALE_DAYS * 86400;
    const allClients = await this._cache.getAllOAuthClients();
    const stale = allClients.filter((c) => c.lastTokenActivityAt < cutoff);

    let tokensRemoved = 0;
    for (const c of stale) {
      const allTokens = await this._cache.getAllOAuthTokens();
      const beforeCount = allTokens.filter((t) => t.clientId === c.clientId).length;
      await this._tokenStore.removeAllForClient(c.clientId); // cascade (AC5.4)
      await this._clientStore.deleteClient(c.clientId);
      tokensRemoved += beforeCount;
    }

    // (2) In-memory store sweeps — bound memory under sustained /authorize traffic
    const authRequestsRemoved = this._authRequests.sweepExpired();
    const authCodesRemoved = this._authCodes.sweepExpired();

    return {
      clientsRemoved: stale.length,
      tokensRemoved,
      authRequestsRemoved,
      authCodesRemoved,
    };
  }

  private async _loop(): Promise<void> {
    // Capture signal locally to avoid null-dereference if stop() fires mid-loop
    // (mirrors SyncEngine._loop() pattern from src/paprika/sync.ts)
    while (this._ac !== null && !this._ac.signal.aborted) {
      try {
        await this.sweepOnce();
      } catch {
        // Never throws — loop must not crash on transient cache errors
      }
      try {
        await wait(this._intervalMs, undefined, { signal: this._ac.signal });
      } catch {
        // AbortError from stop() — exit loop cleanly
        return;
      }
    }
  }
}
