/**
 * OIDC upstream client: discovery loading and id_token verification.
 *
 * Two public functions:
 * - `loadDiscovery(discoveryUrl, allowedAlgs)`: Fetch and validate RFC 8414 discovery document at startup
 * - `verifyIdToken(token, jwks, expectations)`: Verify id_token signature + claims + nonce
 *
 * Uses `jose@^6.2.3` for JWT verification and JWKS management.
 * `loadDiscovery` is one-shot (no caching); `verifyIdToken` uses jose's built-in JWKS cache.
 */

import { z } from "zod";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { OAuthMetadataValidationError } from "./errors.js";
import { IdTokenPayloadSchema } from "./types.js";
import { JWKS_CACHE_TTL_MS } from "./tokens.js";

// ============================================================================
// Discovery Document Schema (RFC 8414 + OpenID Connect Discovery)
// ============================================================================

const DiscoveryDocSchema = z.object({
  issuer: z.string().url(),
  authorization_endpoint: z.string().url(),
  token_endpoint: z.string().url(),
  jwks_uri: z.string().url(),
  userinfo_endpoint: z.string().url().optional(),
  id_token_signing_alg_values_supported: z.array(z.string()).min(1),
  response_types_supported: z.array(z.string()).optional(),
  scopes_supported: z.array(z.string()).optional(),
});

export type DiscoveryDoc = z.infer<typeof DiscoveryDocSchema>;

// ============================================================================
// loadDiscovery: Fetch and validate upstream OIDC discovery document
// ============================================================================

/**
 * Fetches and validates an OIDC discovery document from the given URL.
 *
 * Process:
 * 1. Check discoveryUrl protocol is https://
 * 2. Fetch with 10-second timeout
 * 3. Check response.ok (2xx status)
 * 4. Parse JSON and validate with Zod
 * 5. Check every endpoint URL (issuer, authorization_endpoint, token_endpoint, jwks_uri, userinfo_endpoint) is https://
 * 6. Verify algorithm overlap (upstream algorithms ∩ allowed algorithms must be non-empty)
 * 7. Return validated discovery document
 *
 * Throws `OAuthMetadataValidationError` on any validation failure.
 * AC7.5: All endpoint URLs must be https://
 *
 * @param discoveryUrl - OIDC discovery URL (must be https://)
 * @param allowedAlgs - Algorithms we accept for id_token signing (e.g., ["RS256", "ES256"])
 * @returns Validated discovery document
 * @throws OAuthMetadataValidationError if validation fails
 */
export async function loadDiscovery(discoveryUrl: string, allowedAlgs: ReadonlyArray<string>): Promise<DiscoveryDoc> {
  // Step 1: Verify discoveryUrl itself is https://
  const url = new URL(discoveryUrl);
  if (url.protocol !== "https:") {
    throw OAuthMetadataValidationError.nonHttps("discoveryUrl", discoveryUrl);
  }

  // Step 2: Fetch with timeout
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (cause) {
    throw new OAuthMetadataValidationError("failed to fetch OIDC discovery document", { cause });
  }

  // Step 3: Check response status
  if (!response.ok) {
    throw OAuthMetadataValidationError.discoveryFetchFailed(url.toString(), response.status);
  }

  // Step 4: Parse and validate JSON
  let json: unknown;
  try {
    json = await response.json();
  } catch (cause) {
    throw new OAuthMetadataValidationError("failed to parse discovery document as JSON", { cause });
  }

  const parseResult = DiscoveryDocSchema.safeParse(json);
  if (!parseResult.success) {
    throw OAuthMetadataValidationError.invalidDiscoveryDoc(parseResult.error.issues);
  }
  const doc = parseResult.data;

  // Step 5: AC7.5 — verify all endpoint URLs are https://
  const urlsToCheck: Array<[field: string, value: string | undefined]> = [
    ["issuer", doc.issuer],
    ["authorization_endpoint", doc.authorization_endpoint],
    ["token_endpoint", doc.token_endpoint],
    ["jwks_uri", doc.jwks_uri],
    ["userinfo_endpoint", doc.userinfo_endpoint],
  ];

  for (const [field, value] of urlsToCheck) {
    if (value === undefined) continue;
    const endpointUrl = new URL(value);
    if (endpointUrl.protocol !== "https:") {
      throw OAuthMetadataValidationError.nonHttps(field, value);
    }
  }

  // Step 6: Verify algorithm overlap
  const overlap = doc.id_token_signing_alg_values_supported.filter((alg) => allowedAlgs.includes(alg));
  if (overlap.length === 0) {
    throw OAuthMetadataValidationError.noAlgOverlap(doc.id_token_signing_alg_values_supported, Array.from(allowedAlgs));
  }

  return doc;
}

// ============================================================================
// JWKS Helper: Create remote JWK set with caching
// ============================================================================

/**
 * Creates a remote JWKS fetcher with caching.
 *
 * Wraps `createRemoteJWKSet` with explicit cache TTL matching `JWKS_CACHE_TTL_MS`.
 * The returned function is used as the `jwks` parameter to `verifyIdToken`.
 *
 * @param discovery - OIDC discovery document containing jwks_uri
 * @returns JWKS getter function for use with jwtVerify
 */
export function createJwksFor(discovery: DiscoveryDoc): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(discovery.jwks_uri), {
    cacheMaxAge: JWKS_CACHE_TTL_MS,
  });
}

// ============================================================================
// ID Token Verification: Expectations and Verification
// ============================================================================

/**
 * Expected claims for id_token verification.
 *
 * Passed to verifyIdToken to enforce signature algorithm, issuer, audience,
 * and nonce checks.
 */
export interface VerifyIdTokenExpectations {
  /**
   * Client ID (aud claim in id_token).
   * Usually the OIDC client_id registered with upstream IdP.
   */
  readonly clientId: string;

  /**
   * Expected issuer (iss claim in id_token).
   * Usually discovery.issuer.
   */
  readonly issuer: string;

  /**
   * Expected nonce (nonce claim in id_token).
   * Must match the nonce sent in the authorization request.
   * Prevents CSRF attacks.
   */
  readonly nonce: string;

  /**
   * Algorithms allowed for id_token signatures.
   * Default: ["RS256", "ES256"].
   * Restricts signature verification to asymmetric algorithms only.
   */
  readonly allowedAlgs: ReadonlyArray<string>;
}

/**
 * Verifies an id_token from upstream OIDC provider.
 *
 * Process:
 * 1. Verify JWT signature using provided JWKS
 * 2. Check issuer, audience, and expiration via jwtVerify
 * 3. Check algorithm is in allowlist (defense-in-depth with jose)
 * 4. Check nonce matches (required, not built into jose)
 * 5. Validate payload shape with IdTokenPayloadSchema
 *
 * AC7.3: alg=none is rejected unconditionally by jose
 * AC7.4: alg=HS256 is rejected because not in allowlist (and symmetric keys ignored by JWKS)
 * AC7.8: nonce mismatch throws after signature verification
 *
 * @param idToken - Signed id_token from upstream IdP
 * @param jwks - JWKS getter (from createJwksFor)
 * @param expectations - Expected claims and algorithms
 * @returns Parsed and validated id_token payload
 * @throws OAuthMetadataValidationError on any verification failure
 */
export async function verifyIdToken(
  idToken: string,
  jwks: JWTVerifyGetKey,
  expectations: VerifyIdTokenExpectations,
): Promise<Awaited<ReturnType<typeof IdTokenPayloadSchema.parseAsync>>> {
  // Step 1-3: Signature verification, issuer/audience/expiration checks, algorithm validation
  let payload: Record<string, unknown>;
  try {
    const result = await jwtVerify(idToken, jwks, {
      algorithms: [...expectations.allowedAlgs],
      issuer: expectations.issuer,
      audience: expectations.clientId,
      clockTolerance: 60,
    });
    payload = result.payload;
  } catch (cause) {
    // jose's error types: JOSEAlgNotAllowed, JWSSignatureVerificationFailed,
    // JWTExpired, JWTClaimValidationFailed, JWTInvalid, etc.
    // All wrap into our semantic error
    throw OAuthMetadataValidationError.idTokenInvalid(cause instanceof Error ? cause.message : String(cause), {
      cause,
    });
  }

  // Step 4: Nonce verification (NOT built into jose)
  // Must run AFTER signature verification succeeds to prevent timing attacks
  if (typeof payload["nonce"] !== "string" || payload["nonce"] !== expectations.nonce) {
    throw OAuthMetadataValidationError.nonceMismatch();
  }

  // Step 5: Validate payload shape
  return IdTokenPayloadSchema.parseAsync(payload);
}
