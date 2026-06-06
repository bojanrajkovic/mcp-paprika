/**
 * TokenStore — OAuth 2.1 access + refresh token lifecycle
 *
 * Manages issuance, lookup, rotation, and revocation of opaque bearer tokens.
 * All tokens are hashed before storage; plaintexts returned only once at issuance.
 *
 * Every method is `Result`-native (ADR-0014): the error channel is the SDK's
 * `OAuthError` — domain outcomes (invalid_grant, invalid_scope, …) come from the
 * `OAuthTokenError` factories, and a disk-cache failure maps to a generic
 * `server_error` (the wire-safe shape the provider rethrows at the SDK edge).
 *
 * Exports:
 * - TokenStore: Main class
 * - IssuedPair: Result shape from issuance/rotation
 */

import type { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { Mutex } from "async-mutex";
import { err, ok, okAsync, type Result, ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError } from "../cache/disk-cache.js";
import type { VerifiedIdentity } from "./allowlist.js";
import type { AuthCache } from "./disk.js";
import type { OAuthToken } from "./types.js";

import { SILENT_LOG } from "../utils/log.js";
import { OAuthTokenError } from "./errors.js";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateOpaqueToken,
  hashTokenForStorage,
  nowSeconds,
  REFRESH_TOKEN_TTL_SECONDS,
} from "./tokens.js";

// ============================================================================
// Exports
// ============================================================================

export interface IssuedPair {
  readonly access: { readonly plaintext: string; readonly expiresAt: number };
  readonly refresh: { readonly plaintext: string; readonly expiresAt: number };
  /**
   * Identity bound to the issued/rotated pair. For `issueAccessRefreshPair`,
   * this echoes the input identity; for `rotateRefresh`, it's the rotated-out
   * token's identity (the new pair carries the same identity by definition).
   * Surfacing it on the result lets the provider log refresh-grant state
   * transitions without a separate disk read.
   */
  readonly identity: VerifiedIdentity;
}

// ============================================================================
// TokenStore Class
// ============================================================================

export class TokenStore {
  // Serializes rotateRefresh across the whole store. The window between
  // `lookupRefreshToken` and `removeOAuthToken` would otherwise let two
  // concurrent rotations both observe the same token as valid and both mint
  // new pairs (refresh-token replay). Single-mutex throughput is fine here:
  // rotations are bounded by ACCESS_TOKEN_TTL_SECONDS (~once per 24h per
  // session).
  private readonly _rotateLock = new Mutex();

  constructor(
    private readonly _cache: AuthCache,
    private readonly _now: () => number = () => nowSeconds(),
    private readonly log: Logger = SILENT_LOG,
  ) {}

  /**
   * Map a cache failure to the wire-safe `server_error`, logging the real
   * failure for the operator first — the SDK response carries only the generic
   * message, so this log line is the diagnosable trail.
   */
  private _storeUnavailable(e: CacheError): OAuthError {
    this.log.error({ err: e.cause, context: e.context }, "token store cache failure");
    return OAuthTokenError.serverError("token store unavailable");
  }

  /**
   * Issues a new access + refresh token pair for a client.
   *
   * Resolves with the plaintexts only once in IssuedPair. Both tokens are hashed
   * and persisted to the cache. After successful persistence, updates the
   * client's `lastTokenActivityAt` timestamp, then flushes.
   */
  issueAccessRefreshPair(input: {
    readonly clientId: string;
    readonly identity: VerifiedIdentity;
    readonly scope: string;
    readonly resource: string;
  }): ResultAsync<IssuedPair, OAuthError> {
    const accessPlain = generateOpaqueToken("mcp_at_");
    const refreshPlain = generateOpaqueToken("mcp_rt_");
    const now = this._now();
    const accessExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
    const refreshExpiresAt = now + REFRESH_TOKEN_TTL_SECONDS;

    const access: OAuthToken = {
      tokenHash: hashTokenForStorage(accessPlain),
      kind: "access",
      clientId: input.clientId,
      scope: input.scope,
      identity: input.identity,
      resource: input.resource,
      expiresAt: accessExpiresAt,
      createdAt: now,
    };
    const refresh: OAuthToken = {
      tokenHash: hashTokenForStorage(refreshPlain),
      kind: "refresh",
      clientId: input.clientId,
      scope: input.scope,
      identity: input.identity,
      resource: input.resource,
      expiresAt: refreshExpiresAt,
      createdAt: now,
    };

    return this._cache.oauthTokens
      .put(access)
      .andThen(() => this._cache.oauthTokens.put(refresh))
      .andThen(() => this._bumpLastActivity(input.clientId, now))
      .andThen(() => this._cache.flush())
      .mapErr((e) => this._storeUnavailable(e))
      .map(() => ({
        access: { plaintext: accessPlain, expiresAt: accessExpiresAt },
        refresh: { plaintext: refreshPlain, expiresAt: refreshExpiresAt },
        identity: input.identity,
      }));
  }

  /**
   * Looks up an access token by its plaintext.
   *
   * Resolves with an AuthInfo shape suitable for use in @modelcontextprotocol/sdk
   * authorization handshakes, or null if the token is missing, wrong kind,
   * or expired.
   *
   * Does not flush on read — lazy eviction means expired tokens stay on disk
   * until explicitly revoked or rotated away.
   */
  lookupAccessToken(plaintext: string): ResultAsync<AuthInfo | null, OAuthError> {
    const hash = hashTokenForStorage(plaintext);
    return this._cache.oauthTokens
      .get(hash)
      .mapErr((e) => this._storeUnavailable(e))
      .map((record) => {
        if (record === null || record.kind !== "access") return null;
        if (record.expiresAt < this._now()) return null; // lazy eviction

        // record.resource may be "" when claude.ai didn't send a `resource` param.
        // new URL("") throws — only construct URL when present.
        const resource = record.resource !== "" ? new URL(record.resource) : undefined;

        return {
          token: plaintext,
          clientId: record.clientId,
          scopes: record.scope.split(" ").filter(Boolean),
          expiresAt: record.expiresAt,
          ...(resource !== undefined ? { resource } : {}),
          extra: {
            email: record.identity.email,
            sub: record.identity.sub,
            source: record.identity.source,
          },
        };
      });
  }

  /**
   * Looks up a refresh token by its plaintext.
   *
   * Resolves with the full OAuthToken record (for scope/resource validation
   * during rotation), or null if missing, wrong kind, or expired.
   *
   * Does not flush on read.
   */
  lookupRefreshToken(plaintext: string): ResultAsync<OAuthToken | null, OAuthError> {
    const hash = hashTokenForStorage(plaintext);
    return this._cache.oauthTokens
      .get(hash)
      .mapErr((e) => this._storeUnavailable(e))
      .map((record) => {
        if (record === null || record.kind !== "refresh") return null;
        if (record.expiresAt < this._now()) return null;
        return record;
      });
  }

  /**
   * Exchanges a refresh token for a new access + refresh pair.
   *
   * Validates:
   * - Token exists and is not expired (errs invalid_grant if not)
   * - Resource matches (RFC 8707; AC2.10) if supplied (errs invalid_target if not)
   * - Requested scopes are subset of granted (RFC 6749 §6; errs invalid_scope if not)
   *
   * On success:
   * 1. Invalidates the old refresh token IMMEDIATELY (flushes before minting new)  — AC7.7
   * 2. Mints new access + refresh with optional narrowed scope
   * 3. Links new refresh to old via rotatedFromHash for audit trail
   * 4. Bumps lastTokenActivityAt and flushes
   */
  rotateRefresh(
    plaintext: string,
    expectedClientId: string,
    requestedScopes?: ReadonlyArray<string>,
    requestedResource?: string,
  ): ResultAsync<IssuedPair, OAuthError> {
    // fromPromise + flatten keeps the locked body's Result on the rail; the
    // mutex itself cannot reject (the body resolves a Result), so the mapper is
    // defensive only.
    return ResultAsync.fromPromise(
      this._rotateLock.runExclusive(() =>
        this._rotateRefreshLocked(plaintext, expectedClientId, requestedScopes, requestedResource),
      ),
      () => OAuthTokenError.serverError("token store unavailable"),
    ).andThen((r) => r);
  }

  private async _rotateRefreshLocked(
    plaintext: string,
    expectedClientId: string,
    requestedScopes?: ReadonlyArray<string>,
    requestedResource?: string,
  ): Promise<Result<IssuedPair, OAuthError>> {
    let existing: OAuthToken | null = null;
    const lookupErr = (await this.lookupRefreshToken(plaintext)).match(
      (record) => {
        existing = record;
        return undefined;
      },
      (e) => e,
    );
    if (lookupErr !== undefined) return err(lookupErr);
    if (existing === null) {
      return err(OAuthTokenError.invalidGrant("refresh token invalid or expired"));
    }
    const current: OAuthToken = existing;

    // RFC 6749 §6 / OAuth 2.1 §4.3.1 — a refresh_token may only be used by
    // the client it was issued to. Returning a generic invalid_grant (not a
    // distinct error) avoids leaking existence to a probing client.
    if (current.clientId !== expectedClientId) {
      return err(OAuthTokenError.invalidGrant("refresh token invalid or expired"));
    }

    // RFC 8707 §2 — resource binding (AC2.10)
    if (requestedResource !== undefined && requestedResource !== current.resource) {
      return err(OAuthTokenError.invalidTarget("requested resource does not match the granted resource"));
    }

    // RFC 6749 §6 — scope must be subset (no widening)
    const grantedScopes = current.scope.split(" ").filter(Boolean);
    let newScope = current.scope;
    if (requestedScopes !== undefined) {
      const grantedSet = new Set(grantedScopes);
      const allSubset = requestedScopes.every((s) => grantedSet.has(s));
      if (!allSubset) {
        return err(OAuthTokenError.invalidScope("requested scope exceeds the granted scope"));
      }
      newScope = requestedScopes.join(" ");
    }

    // Invalidate the old refresh token IMMEDIATELY (AC7.7)
    const invalidateErr = (
      await this._cache.oauthTokens.remove(current.tokenHash).andThen(() => this._cache.flush())
    ).match(
      () => undefined,
      (e) => this._storeUnavailable(e),
    );
    if (invalidateErr !== undefined) return err(invalidateErr);

    // Mint the new pair with rotation linkage
    const accessPlain = generateOpaqueToken("mcp_at_");
    const refreshPlain = generateOpaqueToken("mcp_rt_");
    const now = this._now();
    const accessExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
    const refreshExpiresAt = now + REFRESH_TOKEN_TTL_SECONDS;

    const mintErr = (
      await this._cache.oauthTokens
        .put({
          tokenHash: hashTokenForStorage(accessPlain),
          kind: "access",
          clientId: current.clientId,
          scope: newScope,
          identity: current.identity,
          resource: current.resource,
          expiresAt: accessExpiresAt,
          createdAt: now,
        })
        .andThen(() =>
          this._cache.oauthTokens.put({
            tokenHash: hashTokenForStorage(refreshPlain),
            kind: "refresh",
            clientId: current.clientId,
            scope: newScope,
            identity: current.identity,
            resource: current.resource,
            expiresAt: refreshExpiresAt,
            createdAt: now,
            rotatedFromHash: current.tokenHash, // audit linkage
          }),
        )
        .andThen(() => this._bumpLastActivity(current.clientId, now))
        .andThen(() => this._cache.flush())
    ).match(
      () => undefined,
      (e) => this._storeUnavailable(e),
    );
    if (mintErr !== undefined) return err(mintErr);

    return ok({
      access: { plaintext: accessPlain, expiresAt: accessExpiresAt },
      refresh: { plaintext: refreshPlain, expiresAt: refreshExpiresAt },
      identity: current.identity,
    });
  }

  /**
   * Looks up any OAuth token (access OR refresh) by plaintext, ignoring
   * expiry. Resolves null if the hash is unknown.
   *
   * Used by callers that need to check ownership (clientId) before acting on
   * a token — e.g. RFC 7009 revocation must verify the requesting client
   * owns the token before revoking, and a stale/expired token still has a
   * real owner.
   */
  getTokenRecord(plaintext: string): ResultAsync<OAuthToken | null, OAuthError> {
    const hash = hashTokenForStorage(plaintext);
    return this._cache.oauthTokens.get(hash).mapErr((e) => this._storeUnavailable(e));
  }

  /**
   * Revokes a token by removing its hash from the cache.
   *
   * Idempotent: revoking a non-existent token is a no-op (DiskCache.removeOAuthToken
   * is idempotent). Idempotency is essential for use in cleanup loops.
   *
   * Acquires `_rotateLock` so it can't interleave with `rotateRefresh`'s
   * lookup→mint window. Without the lock, the sequence
   *   1) rotation reads refresh as valid
   *   2) revoke removes the same refresh
   *   3) rotation removes (no-op) and mints a new pair
   * lets a token the caller just revoked still produce fresh credentials.
   * Under the shared lock, whichever operation acquires the lock first runs
   * atomically and the other observes the post-state.
   */
  revoke(plaintext: string): ResultAsync<void, OAuthError> {
    return ResultAsync.fromPromise(
      this._rotateLock.runExclusive(async (): Promise<Result<void, OAuthError>> => {
        const hash = hashTokenForStorage(plaintext);
        return (await this._cache.oauthTokens.remove(hash).andThen(() => this._cache.flush())).mapErr((e) =>
          this._storeUnavailable(e),
        );
      }),
      () => OAuthTokenError.serverError("token store unavailable"),
    ).andThen((r) => r);
  }

  /**
   * Revokes all tokens issued to a specific client.
   *
   * Used for client deregistration or session invalidation. Idempotent.
   *
   * Acquires `_rotateLock` so a concurrent `rotateRefresh` can't slip a new
   * pair onto disk between the snapshot and the deletes. Without the lock:
   *   1) `removeAllForClient` calls `getAllOAuthTokens` → snapshot
   *   2) `rotateRefresh` (under the lock by itself) mints a new pair and writes it
   *   3) `removeAllForClient` deletes the snapshot tokens — the new pair survives
   * Sharing the rotation lock makes both operations atomic with respect to each
   * other: whichever wins runs to completion before the other observes state.
   */
  removeAllForClient(clientId: string): ResultAsync<void, OAuthError> {
    return ResultAsync.fromPromise(
      this._rotateLock.runExclusive(async (): Promise<Result<void, OAuthError>> => {
        return (
          await this._cache.oauthTokens
            .getAll()
            .andThen((all) => {
              const matching = all.filter((t) => t.clientId === clientId);
              return ResultAsync.combine(matching.map((t) => this._cache.oauthTokens.remove(t.tokenHash)));
            })
            .andThen(() => this._cache.flush())
        )
          .mapErr((e) => this._storeUnavailable(e))
          .map(() => undefined);
      }),
      () => OAuthTokenError.serverError("token store unavailable"),
    ).andThen((r) => r);
  }

  /**
   * Bumps the client's lastTokenActivityAt timestamp.
   *
   * Called after token issuance and rotation. No-op if client is not found
   * (race with deletion). Does not flush — caller is responsible.
   */
  private _bumpLastActivity(clientId: string, now: number): ResultAsync<void, CacheError> {
    return this._cache.oauthClients.get(clientId).andThen((client) => {
      if (client === null) return okAsync<void, CacheError>(undefined); // race with deletion
      return this._cache.oauthClients.put({ ...client, lastTokenActivityAt: now });
    });
  }
}
