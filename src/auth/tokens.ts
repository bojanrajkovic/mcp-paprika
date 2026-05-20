/**
 * Opaque token generation, hashing, and TTL constants for OAuth 2.1 HTTP transport.
 *
 * Token prefixes identify token type on the wire:
 * - mcp_at_ = access token
 * - mcp_rt_ = refresh token
 * - mcp_ac_ = authorization code
 * - mcp_rat_ = registration access token
 * - mcp_state_ = PKCE state parameter
 * - mcp_nonce_ = nonce parameter
 *
 * No pepper/HMAC hardening is implemented in this version.
 * Future: Consider HMAC-SHA256(plaintext, pepper) as documented in design line 378.
 */

import { randomBytes, createHash } from "node:crypto";

// ============================================================================
// Token Type Identifiers
// ============================================================================

export const TOKEN_PREFIXES = ["mcp_at_", "mcp_rt_", "mcp_ac_", "mcp_rat_", "mcp_state_", "mcp_nonce_"] as const;

export type TokenPrefix = (typeof TOKEN_PREFIXES)[number];

// ============================================================================
// Time helpers
// ============================================================================

/**
 * Current Unix timestamp in seconds.
 *
 * OAuth/OIDC claim shapes use second-resolution Unix time (RFC 7519 §2 — NumericDate).
 * Centralising this here keeps the truncation rule (`Math.floor`, not `Math.trunc` or
 * `Math.round`) consistent across token issuance, schema parsing, and test factories.
 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

// ============================================================================
// Token Generation
// ============================================================================

/**
 * Generates an opaque token with a 256-bit random body (43 base64url chars).
 *
 * Format: `{prefix}{base64url(randomBytes(32))}`
 * Total entropy: 256 bits regardless of prefix.
 * Total length: prefix.length + 43 (e.g., "mcp_at_" = 7 + 43 = 50 chars)
 *
 * @param prefix Token type identifier (mcp_at_, mcp_rt_, etc.)
 * @returns Opaque token with prefix
 */
export function generateOpaqueToken(prefix: TokenPrefix): string {
  const randomBody = randomBytes(32).toString("base64url");
  return `${prefix}${randomBody}`;
}

// ============================================================================
// Token Hashing
// ============================================================================

/**
 * Hashes a token for storage using SHA-256.
 *
 * Returns the hexadecimal digest (64 characters).
 * Deterministic: same input always produces same hash.
 * No HMAC pepper (see design line 378 for future-hardening note).
 *
 * @param plaintext Token plaintext (before hashing)
 * @returns SHA-256 hex digest (64 lowercase hex characters)
 */
export function hashTokenForStorage(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

// ============================================================================
// TTL Constants (design lines 380-391)
// ============================================================================

/** Access token lifetime: 24 hours */
export const ACCESS_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** Refresh token lifetime: 30 days */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** Authorization code lifetime: 60 seconds */
export const AUTH_CODE_TTL_SECONDS = 60;

/** Auth request store lifetime: 5 minutes */
export const AUTH_REQUEST_TTL_SECONDS = 5 * 60;

/** JWKS cache lifetime: 10 minutes (jose default) */
export const JWKS_CACHE_TTL_MS = 10 * 60 * 1000;

/** OIDC discovery document cache lifetime: 24 hours */
export const DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** DCR client registration stale threshold: 90 days */
export const DCR_CLIENT_STALE_DAYS = 90;
