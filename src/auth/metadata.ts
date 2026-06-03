import { createOAuthMetadata, wellKnownRouter } from "@hono/mcp/auth";
import type { OAuthMetadata } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Hono } from "hono";

import type { MintingOAuthServerProvider } from "./provider.js";

/**
 * Builds customized RFC 8414 OAuth authorization server metadata with overrides.
 *
 * Overrides the @hono/mcp defaults:
 * - `token_endpoint_auth_methods_supported` = `["none"]` (public client only)
 * - Removes `revocation_endpoint_auth_methods_supported` (public clients need no credentials)
 * - `authorization_response_iss_parameter_supported` = `true` (RFC 9207)
 * - Removes `id_token_signing_alg_values_supported` (we don't sign id_tokens)
 */
export function buildCustomizedAuthorizationServerMetadata(opts: {
  readonly issuerUrl: string; // STRING, never URL
  readonly provider: MintingOAuthServerProvider;
}): OAuthMetadata {
  const base = createOAuthMetadata({
    issuerUrl: opts.issuerUrl, // string preserves verbatim (no trailing slash)
    provider: opts.provider,
  });

  // AC2.1: public-client only
  base.token_endpoint_auth_methods_supported = ["none"];
  // AC2.13: public-client setup — revocation endpoint accepts tokens without credentials.
  // Delete the field entirely so the flat-value scan in integration tests sees exactly
  // one "none" (token_endpoint_auth_methods_supported). "client_secret_post" from the
  // base response would be misleading for public clients, and advertising ["none"] here
  // would bump the count to 2 and fail the ≤1 assertion.
  delete base.revocation_endpoint_auth_methods_supported;
  // AC2.1: advertise RFC 9207 iss support
  base["authorization_response_iss_parameter_supported"] = true;
  // AC2.13: we don't sign id_tokens, so don't advertise any signing alg
  delete base["id_token_signing_alg_values_supported"];
  // code_challenge_methods_supported is already ["S256"] from createOAuthMetadata.

  return base;
}

/**
 * Builds a Hono router that serves customized OAuth metadata via well-known endpoints.
 *
 * Mount this BEFORE `mcpAuthRouter` so Hono's first-match-wins gives our customized
 * metadata instead of `mcpAuthRouter`'s built-in defaults (which hard-code
 * `token_endpoint_auth_methods_supported: ["client_secret_post"]`).
 */
export function buildAuthMetadataRouter(opts: {
  readonly issuerUrl: string;
  readonly provider: MintingOAuthServerProvider;
  readonly resourceServerUrl: URL; // RFC 9728 resource = issuer
}): Hono {
  const oauthMetadata = buildCustomizedAuthorizationServerMetadata({
    issuerUrl: opts.issuerUrl,
    provider: opts.provider,
  });

  return wellKnownRouter({
    oauthMetadata,
    resourceServerUrl: opts.resourceServerUrl,
  });
}
