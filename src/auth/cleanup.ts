/**
 * AuthCleanup — background maintenance task for OAuth 2.1 state hygiene.
 *
 * Mirrors SyncEngine's lifecycle (src/paprika/sync.ts): idempotent start/stop,
 * AbortController-gated _loop(), never-throws semantics.
 *
 * Responsibilities (run every CLEANUP_INTERVAL_MS = 6h):
 * 1. Remove stale DCR clients (lastTokenActivityAt > 90 days old) + cascade their tokens.
 * 2. Sweep expired in-memory AuthRequestStore, AuthCodeStore, and
 *    PendingAuthorizationStore (consent-ticket) entries.
 * 3. Sweep expired OAuth tokens (expiresAt < now). `rotateRefresh` deletes the
 *    previous refresh token but not the previous access token — every refresh
 *    leaves a soon-to-expire access record behind. Without this sweep,
 *    long-running clients accumulate one expired access token per refresh
 *    until their owning client itself goes stale (90d).
 *
 * Public `sweepOnce()` is exposed for direct testing and for startup use.
 */

import { setTimeout as wait } from "node:timers/promises";

import type { Logger } from "pino";

import type { DiskCacheRoot } from "../cache/disk-cache-root.js";
import type { AuthCodeStore } from "./auth-code-store.js";
import type { AuthRequestStore } from "./auth-request-store.js";
import type { DiskClientRegistrationStore } from "./client-registration.js";
import type { PendingAuthorizationStore } from "./pending-authorization-store.js";
import type { TokenStore } from "./token-store.js";

import { DCR_CLIENT_STALE_DAYS, nowSeconds } from "./tokens.js";

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class AuthCleanup {
  private _ac: AbortController | null = null;

  constructor(
    private readonly _clientStore: DiskClientRegistrationStore,
    private readonly _tokenStore: TokenStore,
    private readonly _cache: DiskCacheRoot,
    private readonly _authRequests: AuthRequestStore,
    private readonly _authCodes: AuthCodeStore,
    private readonly _pendingAuthorizations: PendingAuthorizationStore,
    private readonly log: Logger,
    private readonly _now: () => number = () => nowSeconds(),
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
    expiredTokensRemoved: number;
    authRequestsRemoved: number;
    authCodesRemoved: number;
    pendingAuthorizationsRemoved: number;
  }> {
    const now = this._now();

    // (1) Stale DCR clients: lastTokenActivityAt older than DCR_CLIENT_STALE_DAYS (90d)
    const cutoff = now - DCR_CLIENT_STALE_DAYS * 86400;
    const allClients = await this._cache.oauthClients.getAll();
    const stale = allClients.filter((c) => c.lastTokenActivityAt < cutoff);

    // Fetch tokens once. Precompute per-client counts for the cascade loop and
    // collect expired tokens for the orphan sweep in (3). One pass over all
    // tokens, then we partition by stale-client cascade vs. expired-orphan.
    const allTokens = await this._cache.oauthTokens.getAll();
    const tokensByClient = new Map<string, number>();
    for (const t of allTokens) {
      tokensByClient.set(t.clientId, (tokensByClient.get(t.clientId) ?? 0) + 1);
    }
    const staleClientIds = new Set(stale.map((c) => c.clientId));

    let tokensRemoved = 0;
    for (const c of stale) {
      tokensRemoved += tokensByClient.get(c.clientId) ?? 0;
      await this._tokenStore.removeAllForClient(c.clientId); // cascade (AC5.4)
      await this._clientStore.deleteClient(c.clientId);
    }

    // (2) In-memory store sweeps — bound memory under sustained /authorize traffic
    const authRequestsRemoved = this._authRequests.sweepExpired();
    const authCodesRemoved = this._authCodes.sweepExpired();
    const pendingAuthorizationsRemoved = this._pendingAuthorizations.sweepExpired();

    // (3) Expired-token sweep — remove tokens past `expiresAt` whose owning
    //     client is still active (stale-client cascade already covers the
    //     others). `rotateRefresh` deletes the old refresh but not the old
    //     access; without this an active session leaves one expired access
    //     token on disk per refresh forever.
    let expiredTokensRemoved = 0;
    const expiredOrphans = allTokens.filter((t) => t.expiresAt < now && !staleClientIds.has(t.clientId));
    if (expiredOrphans.length > 0) {
      await Promise.all(expiredOrphans.map((t) => this._cache.oauthTokens.remove(t.tokenHash)));
      await this._cache.flush();
      expiredTokensRemoved = expiredOrphans.length;
    }

    return {
      clientsRemoved: stale.length,
      tokensRemoved,
      expiredTokensRemoved,
      authRequestsRemoved,
      authCodesRemoved,
      pendingAuthorizationsRemoved,
    };
  }

  private async _loop(): Promise<void> {
    // Capture signal locally to avoid null-dereference if stop() fires mid-loop
    // (mirrors SyncEngine._loop() pattern from src/paprika/sync.ts)
    while (this._ac !== null && !this._ac.signal.aborted) {
      try {
        await this.sweepOnce();
      } catch (err) {
        this.log.debug({ err }, "auth cleanup sweep failed; continuing");
      }
      try {
        await wait(this._intervalMs, undefined, { signal: this._ac.signal });
      } catch (err) {
        if (!(err instanceof Error && err.name === "AbortError")) {
          this.log.debug({ err }, "auth cleanup wait failed unexpectedly");
        }
        return;
      }
    }
  }
}
