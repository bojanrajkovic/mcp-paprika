/**
 * AuthCleanup — background maintenance task for OAuth 2.1 state hygiene.
 *
 * Mirrors SyncEngine's lifecycle (src/paprika/sync.ts): idempotent start/stop,
 * AbortController-gated _loop(), never-throws semantics.
 *
 * Responsibilities (run every CLEANUP_INTERVAL_MS = 6h):
 * 1. Sweep expired in-memory AuthRequestStore, AuthCodeStore, and
 *    PendingAuthorizationStore (consent-ticket) entries.
 * 2. Remove stale DCR clients (lastTokenActivityAt > 90 days old) + cascade their tokens.
 * 3. Sweep expired OAuth tokens (expiresAt < now). `rotateRefresh` deletes the
 *    previous refresh token but not the previous access token — every refresh
 *    leaves a soon-to-expire access record behind. Without this sweep,
 *    long-running clients accumulate one expired access token per refresh
 *    until their owning client itself goes stale (90d).
 *
 * Public `sweepOnce()` is exposed for direct testing and for startup use.
 */

import { setTimeout as wait } from "node:timers/promises";

import type { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { err, ok, type Result, ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError } from "../cache/disk-cache.js";
import type { AuthCodeStore } from "./auth-code-store.js";
import type { AuthRequestStore } from "./auth-request-store.js";
import type { DiskClientRegistrationStore } from "./client-registration.js";
import type { AuthCache } from "./disk.js";
import type { PendingAuthorizationStore } from "./pending-authorization-store.js";
import type { TokenStore } from "./token-store.js";
import type { OAuthClient, OAuthToken } from "./types.js";

import { DCR_CLIENT_STALE_DAYS, nowSeconds } from "./tokens.js";

/**
 * What a sweep can fail with: the cache's error on a direct read/remove, or the
 * token store's already-mapped OAuth `server_error` from the cascade. The loop
 * only logs either.
 */
export type SweepError = CacheError | OAuthError;

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class AuthCleanup {
  private _ac: AbortController | null = null;

  constructor(
    private readonly _clientStore: DiskClientRegistrationStore,
    private readonly _tokenStore: TokenStore,
    private readonly _cache: AuthCache,
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
   * `Result`-native: errs with {@link SweepError} on a disk/store failure. The
   * background loop (`_loop`) logs an err and continues.
   *
   * Resolves with counts of removed entries for observability.
   */
  async sweepOnce(): Promise<
    Result<
      {
        clientsRemoved: number;
        tokensRemoved: number;
        expiredTokensRemoved: number;
        authRequestsRemoved: number;
        authCodesRemoved: number;
        pendingAuthorizationsRemoved: number;
      },
      SweepError
    >
  > {
    const now = this._now();

    // (1) In-memory store sweeps — bound memory under sustained /authorize
    //     traffic. Synchronous and infallible, so they run BEFORE any disk
    //     work: a cache failure in the disk steps below errs out of the sweep,
    //     and these must not sit a full interval behind a persistently sick
    //     disk.
    const authRequestsRemoved = this._authRequests.sweepExpired();
    const authCodesRemoved = this._authCodes.sweepExpired();
    const pendingAuthorizationsRemoved = this._pendingAuthorizations.sweepExpired();

    // (2) Stale DCR clients: lastTokenActivityAt older than DCR_CLIENT_STALE_DAYS (90d).
    //     From here on every step talks to the same disk cache, so the first
    //     failure errs out honestly — the loop logs it and the next interval
    //     retries the lot.
    const cutoff = now - DCR_CLIENT_STALE_DAYS * 86400;
    let allClients: ReadonlyArray<OAuthClient> = [];
    let allTokens: ReadonlyArray<OAuthToken> = [];
    const snapshotErr = (
      await ResultAsync.combine([this._cache.oauthClients.getAll(), this._cache.oauthTokens.getAll()])
    ).match(
      ([clients, tokens]) => {
        allClients = clients;
        allTokens = tokens;
        return undefined;
      },
      (e) => e,
    );
    if (snapshotErr !== undefined) return err(snapshotErr);
    const stale = allClients.filter((c) => c.lastTokenActivityAt < cutoff);

    // Precompute per-client counts for the cascade loop and collect expired
    // tokens for the orphan sweep in (3). One pass over all tokens, then we
    // partition by stale-client cascade vs. expired-orphan.
    const tokensByClient = new Map<string, number>();
    for (const t of allTokens) {
      tokensByClient.set(t.clientId, (tokensByClient.get(t.clientId) ?? 0) + 1);
    }
    const staleClientIds = new Set(stale.map((c) => c.clientId));

    let tokensRemoved = 0;
    for (const c of stale) {
      const cascadeErr = (
        await this._tokenStore.removeAllForClient(c.clientId).andThen(
          () => this._clientStore.deleteClient(c.clientId), // cascade (AC5.4)
        )
      ).match(
        () => undefined,
        (e) => e,
      );
      if (cascadeErr !== undefined) return err(cascadeErr);
      tokensRemoved += tokensByClient.get(c.clientId) ?? 0;
    }

    // (3) Expired-token sweep — remove tokens past `expiresAt` whose owning
    //     client is still active (stale-client cascade already covers the
    //     others). `rotateRefresh` deletes the old refresh but not the old
    //     access; without this an active session leaves one expired access
    //     token on disk per refresh forever.
    let expiredTokensRemoved = 0;
    const expiredOrphans = allTokens.filter((t) => t.expiresAt < now && !staleClientIds.has(t.clientId));
    if (expiredOrphans.length > 0) {
      const sweepErr = (
        await ResultAsync.combine(expiredOrphans.map((t) => this._cache.oauthTokens.remove(t.tokenHash))).andThen(() =>
          this._cache.flush(),
        )
      ).match(
        () => undefined,
        (e) => e,
      );
      if (sweepErr !== undefined) return err(sweepErr);
      expiredTokensRemoved = expiredOrphans.length;
    }

    return ok({
      clientsRemoved: stale.length,
      tokensRemoved,
      expiredTokensRemoved,
      authRequestsRemoved,
      authCodesRemoved,
      pendingAuthorizationsRemoved,
    });
  }

  private async _loop(): Promise<void> {
    // Capture signal locally to avoid null-dereference if stop() fires mid-loop
    // (mirrors the background sync loop's pattern in src/server/sync-loop.ts)
    while (this._ac !== null && !this._ac.signal.aborted) {
      (await this.sweepOnce()).match(
        () => undefined,
        (e) => {
          this.log.debug({ err: e }, "auth cleanup sweep failed; continuing");
        },
      );
      try {
        await wait(this._intervalMs, undefined, { signal: this._ac.signal });
      } catch {
        // `wait` rejects only on abort (`stop()` was called) — exit the loop.
        return;
      }
    }
  }
}
