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
import { OAuthMetadataValidationError } from "./errors.js";

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
