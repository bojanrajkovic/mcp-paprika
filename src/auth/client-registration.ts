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

import { randomUUID } from "node:crypto";
import { generateOpaqueToken, hashTokenForStorage } from "./tokens.js";
import { validateRegistration, validateUpdate } from "./dcr-validator.js";
import { OAuthClientNotFoundError } from "./errors.js";
import type { OAuthClient } from "./types.js";
import { DiskCache } from "../cache/disk-cache.js";

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
    private readonly _cache: DiskCache,
    private readonly _publicUrl: string,
  ) {}

  /**
   * Get a registered client by ID.
   * Returns undefined if not found.
   */
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const client = await this._cache.getOAuthClient(clientId);
    if (client === null) return undefined;
    return storedToWire(client);
  }

  /**
   * Register a new client.
   * Validates metadata, generates clientId + RAT, persists, returns wire format with plaintext RAT.
   * Throws OAuthMetadataValidationError on invalid metadata.
   */
  async registerClient(metaIn: unknown): Promise<OAuthClientInformationFull> {
    // Validate via dcr-validator; match() usage per FCIS + project neverthrow rules
    const validated = validateRegistration(metaIn).match(
      (v) => v,
      (e) => {
        throw e;
      },
    );

    const clientId = randomUUID();
    const registrationAccessToken = generateOpaqueToken("mcp_rat_");
    const now = Math.floor(Date.now() / 1000);

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

    await this._cache.putOAuthClient(stored);
    await this._cache.flush();

    return storedToWire(stored, {
      registrationAccessToken,
      registrationClientUri: `${this._publicUrl}/register/${clientId}`,
    });
  }

  /**
   * Update an existing client's metadata (RFC 7592 PUT).
   * Validates patch, preserves RAT hash, updates metadata, bumps updatedAt.
   * Returns wire format with registration_client_uri but NO plaintext RAT (client retains original from 201).
   * Throws OAuthClientNotFoundError if client doesn't exist.
   * Throws OAuthMetadataValidationError on invalid metadata.
   */
  async updateClient(clientId: string, metaIn: unknown): Promise<OAuthClientInformationFull> {
    const existing = await this._cache.getOAuthClient(clientId);
    if (existing === null) throw OAuthClientNotFoundError.forId(clientId);

    // Validate patch via dcr-validator
    const validated = validateUpdate(metaIn).match(
      (v) => v,
      (e) => {
        throw e;
      },
    );

    const now = Math.floor(Date.now() / 1000);

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

    await this._cache.putOAuthClient(updated);
    await this._cache.flush();

    return storedToWire(updated, {
      registrationClientUri: `${this._publicUrl}/register/${clientId}`,
    });
  }

  /**
   * Delete a client.
   * Removes from cache and disk. No cascade — caller (Phase 6 route) composes with TokenStore.removeAllForClient.
   */
  async deleteClient(clientId: string): Promise<void> {
    await this._cache.removeOAuthClient(clientId);
    await this._cache.flush();
  }

  /**
   * Verify a registration access token against a client's stored hash.
   * Returns true if the hashes match, false otherwise (including client not found).
   */
  async verifyRegistrationAccessToken(clientId: string, presentedToken: string): Promise<boolean> {
    const client = await this._cache.getOAuthClient(clientId);
    if (client === null) return false;

    const presentedHash = hashTokenForStorage(presentedToken);
    return presentedHash === client.registrationAccessTokenHash;
  }
}
