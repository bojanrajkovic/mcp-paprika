/**
 * TokenStore — OAuth 2.1 access + refresh token lifecycle
 *
 * Manages issuance, lookup, rotation, and revocation of opaque bearer tokens.
 * All tokens are hashed before storage; plaintexts returned only once at issuance.
 *
 * Exports:
 * - TokenStore: Main class
 * - IssuedPair: Result shape from issuance/rotation
 */

import { err, ok, type Result } from "neverthrow";
import { Mutex } from "async-mutex";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { DiskCache } from "../cache/disk-cache.js";
import {
  generateOpaqueToken,
  hashTokenForStorage,
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  nowSeconds,
} from "./tokens.js";
import { OAuthTokenError } from "./errors.js";
import type { OAuthToken } from "./types.js";
import type { VerifiedIdentity } from "./allowlist.js";

// ============================================================================
// Exports
// ============================================================================

export interface IssuedPair {
  readonly access: { readonly plaintext: string; readonly expiresAt: number };
  readonly refresh: { readonly plaintext: string; readonly expiresAt: number };
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
    private readonly _cache: DiskCache,
    private readonly _now: () => number = () => nowSeconds(),
  ) {}

  /**
   * Issues a new access + refresh token pair for a client.
   *
   * Returns the plaintexts only once in IssuedPair. Both tokens are hashed and
   * persisted to the cache. After successful persistence, updates the client's
   * `lastTokenActivityAt` timestamp, then flushes.
   */
  async issueAccessRefreshPair(input: {
    readonly clientId: string;
    readonly identity: VerifiedIdentity;
    readonly scope: string;
    readonly resource: string;
  }): Promise<IssuedPair> {
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

    await this._cache.putOAuthToken(access);
    await this._cache.putOAuthToken(refresh);
    await this._bumpLastActivity(input.clientId, now);
    await this._cache.flush();

    return {
      access: { plaintext: accessPlain, expiresAt: accessExpiresAt },
      refresh: { plaintext: refreshPlain, expiresAt: refreshExpiresAt },
    };
  }

  /**
   * Looks up an access token by its plaintext.
   *
   * Returns an AuthInfo shape suitable for use in @modelcontextprotocol/sdk
   * authorization handshakes. Returns null if the token is missing, wrong kind,
   * or expired.
   *
   * Does not flush on read — lazy eviction means expired tokens stay on disk
   * until explicitly revoked or rotated away.
   */
  async lookupAccessToken(plaintext: string): Promise<AuthInfo | null> {
    const hash = hashTokenForStorage(plaintext);
    const record = await this._cache.getOAuthToken(hash);
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
  }

  /**
   * Looks up a refresh token by its plaintext.
   *
   * Returns the full OAuthToken record (for scope/resource validation during rotation).
   * Returns null if missing, wrong kind, or expired.
   *
   * Does not flush on read.
   */
  async lookupRefreshToken(plaintext: string): Promise<OAuthToken | null> {
    const hash = hashTokenForStorage(plaintext);
    const record = await this._cache.getOAuthToken(hash);
    if (record === null || record.kind !== "refresh") return null;
    if (record.expiresAt < this._now()) return null;
    return record;
  }

  /**
   * Exchanges a refresh token for a new access + refresh pair.
   *
   * Validates:
   * - Token exists and is not expired (returns invalid_grant if not)
   * - Resource matches (RFC 8707; AC2.10) if supplied (returns invalid_target if not)
   * - Requested scopes are subset of granted (RFC 6749 §6; returns invalid_scope if not)
   *
   * On success:
   * 1. Invalidates the old refresh token IMMEDIATELY (flushes before minting new)  — AC7.7
   * 2. Mints new access + refresh with optional narrowed scope
   * 3. Links new refresh to old via rotatedFromHash for audit trail
   * 4. Bumps lastTokenActivityAt and flushes
   *
   * Returns Result<IssuedPair, OAuthError>.
   */
  async rotateRefresh(
    plaintext: string,
    expectedClientId: string,
    requestedScopes?: ReadonlyArray<string>,
    requestedResource?: string,
  ): Promise<Result<IssuedPair, OAuthError>> {
    return this._rotateLock.runExclusive(async () => {
      const existing = await this.lookupRefreshToken(plaintext);
      if (existing === null) {
        return err(OAuthTokenError.invalidGrant("refresh token invalid or expired"));
      }

      // RFC 6749 §6 / OAuth 2.1 §4.3.1 — a refresh_token may only be used by
      // the client it was issued to. Returning a generic invalid_grant (not a
      // distinct error) avoids leaking existence to a probing client.
      if (existing.clientId !== expectedClientId) {
        return err(OAuthTokenError.invalidGrant("refresh token invalid or expired"));
      }

      // RFC 8707 §2 — resource binding (AC2.10)
      if (requestedResource !== undefined && requestedResource !== existing.resource) {
        return err(OAuthTokenError.invalidTarget("requested resource does not match the granted resource"));
      }

      // RFC 6749 §6 — scope must be subset (no widening)
      const grantedScopes = existing.scope.split(" ").filter(Boolean);
      let newScope = existing.scope;
      if (requestedScopes !== undefined) {
        const grantedSet = new Set(grantedScopes);
        const allSubset = requestedScopes.every((s) => grantedSet.has(s));
        if (!allSubset) {
          return err(OAuthTokenError.invalidScope("requested scope exceeds the granted scope"));
        }
        newScope = requestedScopes.join(" ");
      }

      // Invalidate the old refresh token IMMEDIATELY (AC7.7)
      await this._cache.removeOAuthToken(existing.tokenHash);
      await this._cache.flush();

      // Mint the new pair with rotation linkage
      const accessPlain = generateOpaqueToken("mcp_at_");
      const refreshPlain = generateOpaqueToken("mcp_rt_");
      const now = this._now();
      const accessExpiresAt = now + ACCESS_TOKEN_TTL_SECONDS;
      const refreshExpiresAt = now + REFRESH_TOKEN_TTL_SECONDS;

      await this._cache.putOAuthToken({
        tokenHash: hashTokenForStorage(accessPlain),
        kind: "access",
        clientId: existing.clientId,
        scope: newScope,
        identity: existing.identity,
        resource: existing.resource,
        expiresAt: accessExpiresAt,
        createdAt: now,
      });
      await this._cache.putOAuthToken({
        tokenHash: hashTokenForStorage(refreshPlain),
        kind: "refresh",
        clientId: existing.clientId,
        scope: newScope,
        identity: existing.identity,
        resource: existing.resource,
        expiresAt: refreshExpiresAt,
        createdAt: now,
        rotatedFromHash: existing.tokenHash, // audit linkage
      });
      await this._bumpLastActivity(existing.clientId, now);
      await this._cache.flush();

      return ok({
        access: { plaintext: accessPlain, expiresAt: accessExpiresAt },
        refresh: { plaintext: refreshPlain, expiresAt: refreshExpiresAt },
      });
    });
  }

  /**
   * Looks up any OAuth token (access OR refresh) by plaintext, ignoring
   * expiry. Returns null if the hash is unknown.
   *
   * Used by callers that need to check ownership (clientId) before acting on
   * a token — e.g. RFC 7009 revocation must verify the requesting client
   * owns the token before revoking, and a stale/expired token still has a
   * real owner.
   */
  async getTokenRecord(plaintext: string): Promise<OAuthToken | null> {
    const hash = hashTokenForStorage(plaintext);
    return this._cache.getOAuthToken(hash);
  }

  /**
   * Revokes a token by removing its hash from the cache.
   *
   * Idempotent: revoking a non-existent token is a no-op (DiskCache.removeOAuthToken
   * is idempotent). Idempotency is essential for use in cleanup loops.
   */
  async revoke(plaintext: string): Promise<void> {
    const hash = hashTokenForStorage(plaintext);
    await this._cache.removeOAuthToken(hash);
    await this._cache.flush();
  }

  /**
   * Revokes all tokens issued to a specific client.
   *
   * Used for client deregistration or session invalidation. Idempotent.
   */
  async removeAllForClient(clientId: string): Promise<void> {
    const all = await this._cache.getAllOAuthTokens();
    const matching = all.filter((t) => t.clientId === clientId);
    await Promise.all(matching.map((t) => this._cache.removeOAuthToken(t.tokenHash)));
    await this._cache.flush();
  }

  /**
   * Bumps the client's lastTokenActivityAt timestamp.
   *
   * Called after token issuance and rotation. No-op if client is not found
   * (race with deletion). Does not flush — caller is responsible.
   */
  private async _bumpLastActivity(clientId: string, now: number): Promise<void> {
    const client = await this._cache.getOAuthClient(clientId);
    if (client === null) return; // race with deletion
    await this._cache.putOAuthClient({ ...client, lastTokenActivityAt: now });
  }
}
