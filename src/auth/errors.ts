/**
 * Error class hierarchy for OAuth operations.
 *
 * Two-tier structure:
 * - Plain Error subclasses: OAuthConfigError, OAuthMetadataValidationError, OAuthClientNotFoundError, OAuthAllowlistDenialError
 *   These are internal errors that never cross the library boundary.
 * - OAuthTokenError: NOT a class, but a namespace of static factory methods
 *   Each method returns an instance of the appropriate SDK OAuthError subclass.
 *   This is the only error that crosses into @hono/mcp library boundary.
 *
 * All classes support ES2024 ErrorOptions for cause chaining.
 */

import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
  type OAuthError,
  ServerError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { Result } from "neverthrow";

/**
 * OAuth boundary helper: unwrap a `Result` whose error is an
 * SDK `OAuthError`, throwing it into the SDK's throw-based authorization-server
 * contract (`OAuthServerProvider` / the DCR handler), which serializes it as a
 * spec-compliant response. The auth stores speak `Result`; this is the one
 * sanctioned crossing back onto the SDK's throw rail. The `OAuthError`
 * constraint is load-bearing: a non-OAuth error thrown at this edge would be
 * wrapped as a 500 `server_error` instead of its spec response, so callers
 * must `mapErr` to an OAuth type first — and the compiler holds them to it.
 */
export function unwrapOAuth<T, E extends OAuthError>(result: Result<T, E>): T {
  return result.match(
    (value) => value,
    (e) => {
      throw e;
    },
  );
}

/**
 * Error thrown when OAuth configuration validation fails at startup.
 * Examples: missing MCP_PUBLIC_URL, empty allowlists, unknown preset.
 * Never crosses the library boundary — caught in config loading code.
 */
export class OAuthConfigError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OAuthConfigError";
  }

  static missingPublicUrl(): OAuthConfigError {
    return new OAuthConfigError("MCP_PUBLIC_URL is required when MCP_TRANSPORT=http");
  }

  static httpPublicUrl(url: string): OAuthConfigError {
    return new OAuthConfigError(`MCP_PUBLIC_URL must be a valid https:// URL, got: ${url}`);
  }

  static emptyAllowlists(): OAuthConfigError {
    return new OAuthConfigError("at least one of MCP_ALLOWED_EMAILS or MCP_ALLOWED_SUBS must be non-empty");
  }

  static missingPresetOrDiscovery(field: string): OAuthConfigError {
    return new OAuthConfigError(`${field} is required when neither MCP_OIDC_PRESET nor MCP_OIDC_DISCOVERY_URL is set`);
  }

  static unknownPreset(name: string): OAuthConfigError {
    return new OAuthConfigError(`Unknown OIDC preset: ${name}. Expected one of: google, entra, okta, auth0, keycloak`);
  }

  static missingDiscoveryUrl(presetName: string): OAuthConfigError {
    return new OAuthConfigError(`Tenant-bound preset "${presetName}" requires MCP_OIDC_DISCOVERY_URL to be set`);
  }
}

/**
 * Error thrown when OIDC metadata is malformed or id_token verification fails.
 * Examples: discovery document missing required fields, nonce mismatch, invalid algorithms.
 * Caught by /oauth/callback handler and translated to an error redirect.
 */
export class OAuthMetadataValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OAuthMetadataValidationError";
  }

  static nonHttps(field: string, value: unknown): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(`OIDC discovery URL field "${field}" must use https://, got: ${value}`);
  }

  static missingField(field: string): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(`OIDC discovery document missing required field: ${field}`);
  }

  static discoveryFetchFailed(url: string, status: number): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(`failed to fetch OIDC discovery document from ${url}: HTTP ${status}`);
  }

  static invalidDiscoveryDoc(
    issues: Array<{ path: Array<string | number>; message: string }>,
  ): OAuthMetadataValidationError {
    const firstIssue = issues[0];
    const path = firstIssue?.path.join(".") || "unknown";
    const message = firstIssue?.message || "unknown error";
    return new OAuthMetadataValidationError(`invalid OIDC discovery document: ${path} ${message}`);
  }

  static noAlgOverlap(supported: ReadonlyArray<string>, allowed: ReadonlyArray<string>): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(
      `no supported algorithms overlap: upstream advertises [${supported.join(", ")}], we allow [${allowed.join(", ")}]`,
    );
  }

  static idTokenInvalid(message: string, options?: ErrorOptions): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(`id_token verification failed: ${message}`, options);
  }

  static nonceMismatch(): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError("OIDC nonce mismatch: id_token nonce does not match request nonce");
  }

  static invalidAlgorithm(alg: string, allowed: ReadonlyArray<string>): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(
      `id_token signed with unsupported algorithm "${alg}". Allowed: ${allowed.join(", ")}`,
    );
  }

  static expiredToken(exp: number): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(`id_token expired at ${new Date(exp * 1000).toISOString()}`);
  }

  // RFC 7591/7592 DCR validation errors
  static unsupportedAuthMethod(value: unknown): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(`token_endpoint_auth_method must be "none", got: ${JSON.stringify(value)}`);
  }

  static unsupportedGrantType(values: unknown): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(
      `grant_types must be subset of ["authorization_code", "refresh_token"], got: ${JSON.stringify(values)}`,
    );
  }

  static unsupportedResponseType(values: unknown): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(`response_types must be exactly ["code"], got: ${JSON.stringify(values)}`);
  }

  static invalidRedirectUri(uri: string, reason: string): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(`Invalid redirect_uri "${uri}": ${reason}`);
  }

  static emptyRedirectUris(): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError("redirect_uris is required and must contain at least one URI");
  }

  static unsupportedSigningAlg(alg: unknown, allowed: ReadonlyArray<string>): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(
      `id_token_signed_response_alg must be one of [${allowed.join(", ")}], got: ${JSON.stringify(alg)}`,
    );
  }

  static invalidClientMetadata(path: string, message: string): OAuthMetadataValidationError {
    return new OAuthMetadataValidationError(`Client metadata validation failed at "${path}": ${message}`);
  }
}

/**
 * Namespace of static factory methods for OAuth token errors.
 * Each method returns an instance of the appropriate SDK OAuthError subclass.
 * This is the ONLY error that crosses the library boundary into @hono/mcp.
 */
export const OAuthTokenError = {
  /**
   * Authorization grant is invalid, expired, revoked, or mismatched.
   * Maps to SDK InvalidGrantError.
   */
  invalidGrant: (message: string): OAuthError => {
    return new InvalidGrantError(message);
  },

  /**
   * The requested resource/target is invalid, missing, unknown, or malformed.
   * Maps to SDK InvalidTargetError (RFC 8707).
   */
  invalidTarget: (message: string): OAuthError => {
    return new InvalidTargetError(message);
  },

  /**
   * The requested scope is invalid, unknown, or exceeds what was granted.
   * Maps to SDK InvalidScopeError.
   */
  invalidScope: (message: string): OAuthError => {
    return new InvalidScopeError(message);
  },

  /**
   * The access or refresh token is invalid or expired.
   * Maps to SDK InvalidTokenError.
   */
  invalidToken: (): OAuthError => {
    return new InvalidTokenError("token invalid or expired");
  },

  /**
   * An internal store failure (the disk cache erred) surfacing at the SDK
   * boundary. Maps to SDK ServerError (`server_error` on the wire). Keep the
   * message generic — it can cross the wire; the cache layer's own logging
   * carries the real failure for the operator.
   */
  serverError: (message: string): OAuthError => {
    return new ServerError(message);
  },
};

/**
 * Error thrown when a client is not found in the client registry.
 * Used by client-registration and token endpoints.
 * Caught in route handlers and converted to 404 HTTP response.
 */
export class OAuthClientNotFoundError extends Error {
  readonly clientId: string;

  constructor(clientId: string, options?: ErrorOptions) {
    super(`Client not found: ${clientId}`, options);
    this.name = "OAuthClientNotFoundError";
    this.clientId = clientId;
  }

  static forId(clientId: string): OAuthClientNotFoundError {
    return new OAuthClientNotFoundError(clientId);
  }
}

/**
 * Error thrown when an authenticated user is denied by the allowlist.
 * Examples: email not in allowlist, sub not in allowlist, email_verified policy violation.
 * Caught by /oauth/callback handler and translated to an error redirect.
 */
export class OAuthAllowlistDenialError extends Error {
  readonly identity: { email?: string | null; sub?: string };

  constructor(message: string, identity: { email?: string | null; sub?: string }, options?: ErrorOptions) {
    super(message, options);
    this.name = "OAuthAllowlistDenialError";
    this.identity = identity;
  }

  static emailNotVerified(email: string, policy: string): OAuthAllowlistDenialError {
    return new OAuthAllowlistDenialError(
      `Email "${email}" is in allowlist but email_verified policy "${policy}" denied access`,
      { email },
    );
  }

  static notAllowlisted(email: string | null, sub: string): OAuthAllowlistDenialError {
    return new OAuthAllowlistDenialError(`Identity not in allowlist: email="${email}", sub="${sub}"`, { email, sub });
  }
}
