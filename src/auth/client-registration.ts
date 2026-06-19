/**
 * RFC 7591/7592 client registration store backed by DiskCache.
 * Implements OAuthRegisteredClientsStore interface for SDK integration.
 *
 * Core operations:
 * - registerClient: POST /register — validates, mints clientId + RAT, persists, returns with plaintext RAT (one-time)
 * - getClient: GET /register/{client_id} — reads from disk, returns wire format
 * - updateClient: PUT /register/{client_id} — validates patch, preserves RAT hash, returns without plaintext RAT
 * - deleteClient: DELETE /register/{client_id} — removes from disk (cascade handled by caller)
 * - verifyRegistrationAccessToken: used by route handlers to gate PUT/DELETE access
 */

import { randomUUID, timingSafeEqual } from "node:crypto";

import { InvalidClientMetadataError, InvalidRequestError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { errAsync, type ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError } from "../cache/disk-cache.js";
import type { AuthCache } from "./disk.js";
import type { OAuthMetadataValidationError } from "./errors.js";
import type { OAuthClient } from "./types.js";

import { validateRegistration, validateUpdate } from "./dcr-validator.js";
import { OAuthClientNotFoundError, OAuthTokenError, unwrapOAuth } from "./errors.js";
import { dcrRegistrations } from "./telemetry.js";
import { generateOpaqueToken, hashTokenForStorage, nowSeconds } from "./tokens.js";

// ============================================================================
// Wire Format Conversion
// ============================================================================

/**
 * Wire format for client information (RFC 7591 response format).
 * Snake_case to match RFC 7591.
 */
interface OAuthClientInformationFull {
  readonly client_id: string;
  readonly client_id_issued_at: number;
  readonly client_secret_expires_at: 0; // public client, never expires
  readonly client_name?: string;
  readonly grant_types: ReadonlyArray<"authorization_code" | "refresh_token">;
  readonly response_types: ReadonlyArray<"code">;
  readonly redirect_uris: ReadonlyArray<string>;
  readonly scope: string;
  readonly token_endpoint_auth_method: "none";
  readonly registration_access_token?: string; // plaintext, returned only on 201/initial grant
  readonly registration_client_uri?: string; // RFC 7592 §2.2
}

/**
 * Converts a stored OAuthClient record to wire-format snake_case with optional extras.
 * Extras are plaintext RAT and registration_client_uri for 201/200 responses.
 */
function storedToWire(
  stored: OAuthClient,
  extras?: {
    readonly registrationAccessToken?: string;
    readonly registrationClientUri?: string;
  },
): OAuthClientInformationFull {
  return {
    client_id: stored.clientId,
    client_id_issued_at: stored.clientIdIssuedAt,
    client_secret_expires_at: 0,
    ...(stored.clientName !== undefined ? { client_name: stored.clientName } : {}),
    grant_types: stored.grantTypes,
    response_types: stored.responseTypes,
    redirect_uris: stored.redirectUris,
    scope: stored.scope,
    token_endpoint_auth_method: stored.tokenEndpointAuthMethod,
    ...(extras?.registrationAccessToken !== undefined
      ? { registration_access_token: extras.registrationAccessToken }
      : {}),
    ...(extras?.registrationClientUri !== undefined ? { registration_client_uri: extras.registrationClientUri } : {}),
  };
}

// ============================================================================
// DiskClientRegistrationStore
// ============================================================================

export class DiskClientRegistrationStore {
  constructor(
    private readonly _cache: AuthCache,
    private readonly _publicUrl: string,
    private readonly log: Logger,
    /**
     * Hard cap on the number of registered clients. Enforced atomically
     * inside `registerClient` (via `DiskCache.tryPutOAuthClient`) so concurrent
     * registrations can't bypass it through a count-then-put race. Defaults to
     * `Infinity` for tests / callers that don't supply a cap; production wires
     * the cap from config (typically 50, matching the `buildClientCap`
     * middleware's fast-path 429 limit).
     */
    private readonly _maxClients: number = Number.POSITIVE_INFINITY,
  ) {}

  /**
   * Map a cache failure to the wire-safe `server_error`, logging the real
   * failure for the operator first.
   */
  private _registryUnavailable(e: CacheError): ReturnType<typeof OAuthTokenError.serverError> {
    this.log.error({ err: e.cause, context: e.context }, "client registry cache failure");
    return OAuthTokenError.serverError("client registry unavailable");
  }

  /**
   * Get a registered client by ID.
   * Returns undefined if not found.
   *
   * SDK contract (`OAuthRegisteredClientsStore`): throw-based — a cache failure
   * crosses as a `server_error` (via `unwrapOAuth`).
   */
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const client = unwrapOAuth(
      (await this._cache.oauthClients.get(clientId)).mapErr((e) => this._registryUnavailable(e)),
    );
    if (client === null) return undefined;
    return storedToWire(client);
  }

  /**
   * Register a new client.
   * Validates metadata, generates clientId + RAT, persists, returns wire format with plaintext RAT.
   *
   * SDK contract (the DCR handler): throw-based — every throw is an SDK OAuth
   * error type: `InvalidClientMetadataError` (400,
   * `invalid_client_metadata` per RFC 7591 §3.2.2) on invalid metadata,
   * `InvalidRequestError` on the registration cap, `server_error` on a cache failure.
   */
  async registerClient(metaIn: unknown): Promise<OAuthClientInformationFull> {
    // Validate via dcr-validator; pass logger for URL-parse debug diagnosability.
    // The internal validation error is not an SDK `OAuthError` — thrown raw, the
    // router would wrap it as a 500 `server_error` — so it maps to the spec's
    // `invalid_client_metadata` at this edge (RFC 7591 §3.2.2).
    const validated = unwrapOAuth(
      validateRegistration(metaIn, this.log).mapErr((e) => new InvalidClientMetadataError(e.message)),
    );

    const clientId = randomUUID();
    const registrationAccessToken = generateOpaqueToken("mcp_rat_");
    const now = nowSeconds();

    const stored: OAuthClient = {
      clientId,
      clientIdIssuedAt: now,
      registrationAccessTokenHash: hashTokenForStorage(registrationAccessToken),
      tokenEndpointAuthMethod: "none",
      grantTypes: validated.grantTypes,
      responseTypes: validated.responseTypes,
      redirectUris: validated.redirectUris,
      scope: validated.scope,
      clientName: validated.clientName,
      createdAt: now,
      updatedAt: now,
      lastTokenActivityAt: now,
    };

    // Atomic check+put under DiskCache's write mutex. The `buildClientCap`
    // middleware does a non-atomic read-before-write earlier in the request
    // pipeline (cheap fast-path 429 when the cap is obviously hit); this is
    // the authoritative race-safe enforcement. On overflow we throw an OAuth
    // `InvalidRequestError` so @hono/mcp's DCR handler returns 400 with the
    // standard `invalid_request` error code (rather than a 500).
    const result = unwrapOAuth(
      (await this._cache.oauthClients.tryPut(stored, this._maxClients)).mapErr((e) => this._registryUnavailable(e)),
    );
    if (!result.ok) {
      throw new InvalidRequestError(`client registration cap reached (${result.currentCount.toString()} clients)`);
    }
    unwrapOAuth((await this._cache.flush()).mapErr((e) => this._registryUnavailable(e)));
    this.log.info(
      { clientId: stored.clientId, redirectUriCount: stored.redirectUris.length },
      "client registered via DCR",
    );
    dcrRegistrations().add(1);

    return storedToWire(stored, {
      registrationAccessToken,
      registrationClientUri: `${this._publicUrl}/register/${clientId}`,
    });
  }

  /**
   * Update an existing client's metadata (RFC 7592 PUT).
   * Validates patch, preserves RAT hash, updates metadata, bumps updatedAt.
   * Resolves with wire format with registration_client_uri but NO plaintext RAT
   * (client retains original from 201). Consumed by our own RFC 7592 route (not
   * the SDK), so it is `Result`-native: errs with `OAuthClientNotFoundError`
   * when the client doesn't exist, `OAuthMetadataValidationError` on invalid
   * metadata, or `CacheError` on a registry failure (the route renders 503).
   */
  updateClient(
    clientId: string,
    metaIn: unknown,
  ): ResultAsync<OAuthClientInformationFull, OAuthClientNotFoundError | OAuthMetadataValidationError | CacheError> {
    return this._cache.oauthClients.get(clientId).andThen((existing) => {
      if (existing === null) return errAsync(OAuthClientNotFoundError.forId(clientId));

      // Validate patch via dcr-validator; pass logger for URL-parse debug diagnosability
      return validateUpdate(metaIn, this.log).asyncAndThen((validated) => {
        const now = nowSeconds();

        // Merge: spread existing, apply validated patch, reset tokenEndpointAuthMethod
        const updated: OAuthClient = {
          ...existing,
          clientName: validated.clientName !== undefined ? validated.clientName : existing.clientName,
          grantTypes: validated.grantTypes !== undefined ? validated.grantTypes : existing.grantTypes,
          responseTypes: validated.responseTypes !== undefined ? validated.responseTypes : existing.responseTypes,
          redirectUris: validated.redirectUris !== undefined ? validated.redirectUris : existing.redirectUris,
          scope: validated.scope !== undefined ? validated.scope : existing.scope,
          tokenEndpointAuthMethod: "none",
          updatedAt: now,
        };

        return this._cache.oauthClients
          .put(updated)
          .andThen(() => this._cache.flush())
          .map(() =>
            storedToWire(updated, {
              registrationClientUri: `${this._publicUrl}/register/${clientId}`,
            }),
          );
      });
    });
  }

  /**
   * Delete a client.
   * Removes from cache and disk. No cascade — the DELETE /register/:id route
   * composes with TokenStore.removeAllForClient. `Result`-native (our routes and
   * the cleanup loop consume it, not the SDK).
   */
  deleteClient(clientId: string): ResultAsync<void, CacheError> {
    return this._cache.oauthClients
      .remove(clientId)
      .andThen(() => this._cache.flush())
      .map(() => undefined);
  }

  /**
   * Verify a registration access token against a client's stored hash.
   * Resolves true if the hashes match, false otherwise (including client not
   * found); errs with `CacheError` on a registry failure.
   */
  verifyRegistrationAccessToken(clientId: string, presentedToken: string): ResultAsync<boolean, CacheError> {
    return this._cache.oauthClients.get(clientId).map((client) => this._ratMatches(client, presentedToken, clientId));
  }

  private _ratMatches(client: OAuthClient | null, presentedToken: string, clientId: string): boolean {
    if (client === null) return false;

    const presentedHash = hashTokenForStorage(presentedToken);
    const storedHash = client.registrationAccessTokenHash;

    // Both hashes should be 64-character hex strings (SHA-256)
    if (presentedHash.length !== 64 || storedHash.length !== 64) {
      return false;
    }

    // Timing-safe comparison to prevent timing attacks
    try {
      return timingSafeEqual(Buffer.from(presentedHash, "hex"), Buffer.from(storedHash, "hex"));
    } catch (err) {
      this.log.debug({ err, clientId }, "RAT timing-safe equality failed (likely invalid hex)");
      return false;
    }
  }
}
