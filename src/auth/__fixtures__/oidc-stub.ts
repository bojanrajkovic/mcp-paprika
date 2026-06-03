/**
 * Reusable MSW OIDC provider stub for testing OAuth 2.1 flows.
 *
 * Simulates a complete upstream OIDC provider with configurable identity,
 * token expiry, and signing algorithm. Used by Phase 6+ tests and Phase 7 e2e.
 *
 * Four handlers are provided:
 * - GET /.well-known/openid-configuration
 * - GET /jwks
 * - GET /authorize
 * - POST /token
 */

import {
  exportJWK,
  generateKeyPair,
  type GenerateKeyPairResult,
  generateSecret,
  type JWK,
  type JWTPayload,
  SignJWT,
  UnsecuredJWT,
} from "jose";
import { http, type HttpHandler, HttpResponse } from "msw";

import type { DiscoveryDoc } from "../oidc-client.js";

import { nowSeconds } from "../tokens.js";
import { makeEs256Jwt } from "./jose-keys.js";

// ============================================================================
// OidcStub types (forward-declared so helpers below can reference them)
// ============================================================================

export interface OidcStubOptions {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly defaultIdentity: { email: string; sub: string; emailVerified: boolean };
}

export interface OidcStub {
  readonly handlers: ReadonlyArray<HttpHandler>;
  readonly issuer: string;
  readonly discoveryUrl: string;
  authenticateNext(identity: Partial<{ email: string; sub: string; emailVerified: boolean }>): void;
  expireNextToken(): void;
  signWithAlg(alg: "RS256" | "ES256" | "HS256" | "none"): void;
  resetOverrides(): void;
}

// ============================================================================
// F3: makeDiscoveryDoc — Minimal-valid 5-field discovery document literal
// ============================================================================

/**
 * Builds a minimal valid OIDC discovery document for the given base URL.
 *
 * Covers the 5 required fields used by `loadDiscovery` / `createJwksFor` in
 * tests: issuer, authorization_endpoint, token_endpoint, jwks_uri, and
 * id_token_signing_alg_values_supported. Useful wherever tests need a quick
 * discovery doc without the full 9-field shape emitted by the live OidcStub
 * handlers.
 *
 * Note: uses template literals (not `new URL(base).toString()`) to avoid
 * adding a trailing slash to the base URL.
 *
 * @param base  - The IdP base URL, e.g. "https://idp.example.com" (no trailing slash)
 * @param algs  - Signing algorithms to advertise; defaults to ["RS256"]
 */
export function makeDiscoveryDoc(base: string, algs: ReadonlyArray<string> = ["RS256"]): DiscoveryDoc {
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    jwks_uri: `${base}/jwks`,
    id_token_signing_alg_values_supported: [...algs],
  };
}

// ============================================================================
// F2: makeDefaultOidcStub — createOidcStub with canonical test defaults
// ============================================================================

/**
 * Creates an `OidcStub` with the standard test-suite defaults so callers
 * only have to specify what diverges.
 *
 * Defaults:
 *   issuer:         "https://idp.stub.example.com"
 *   clientId:       "stub-client-id"
 *   clientSecret:   "stub-client-secret"
 *   defaultIdentity: { email: "user@example.com", sub: "user-sub-123", emailVerified: true }
 */
export function makeDefaultOidcStub(overrides: Partial<OidcStubOptions> = {}): OidcStub {
  return createOidcStub({
    issuer: "https://idp.stub.example.com",
    clientId: "stub-client-id",
    clientSecret: "stub-client-secret",
    defaultIdentity: {
      email: "user@example.com",
      sub: "user-sub-123",
      emailVerified: true,
    },
    ...overrides,
  });
}

/**
 * Creates a reusable MSW OIDC stub with configurable overrides.
 *
 * @param opts Configuration for the stub
 * @returns OidcStub with handlers ready for server.use(...)
 */
export function createOidcStub(opts: OidcStubOptions): OidcStub {
  // Mutable state for overrides
  let nextIdentity = { ...opts.defaultIdentity };
  let expireNext = false;
  let signAlg: "RS256" | "ES256" | "HS256" | "none" = "RS256";

  // Cached keypair (NOT cached token — tokens are signed fresh per request with correct nonce).
  // Both the public JWK and private key are cached together so /jwks always returns the
  // same key that signs the tokens. makeRsaJwt() generates a fresh keypair on every call,
  // so we cannot use it here — we must cache the private key separately and sign inline.
  let cachedRsaJwk: JWK | null = null;
  let cachedRsaPrivateKey: GenerateKeyPairResult["privateKey"] | null = null;

  // Map from upstream authorization code to captured nonce+state
  const codeToNonce = new Map<string, { nonce: string; state: string }>();

  /**
   * Ensures the RSA keypair is generated and cached, then returns the public JWK.
   * Subsequent calls return the same JWK (and the same private key used to sign).
   */
  async function getOrCreateRsaJwk(): Promise<JWK> {
    if (cachedRsaJwk === null || cachedRsaPrivateKey === null) {
      const { publicKey, privateKey } = await generateKeyPair("RS256");
      const jwk = await exportJWK(publicKey);
      jwk.kid = "stub-rsa-1";
      jwk.alg = "RS256";
      jwk.use = "sig";
      cachedRsaJwk = jwk;
      cachedRsaPrivateKey = privateKey;
    }
    return cachedRsaJwk;
  }

  function buildClaims(identity: typeof opts.defaultIdentity, nonce: string): JWTPayload {
    const now = nowSeconds();
    return {
      iss: opts.issuer,
      sub: identity.sub,
      aud: opts.clientId,
      email: identity.email,
      email_verified: identity.emailVerified,
      nonce, // the actual nonce from /authorize, not a placeholder
      iat: now,
      exp: expireNext ? now - 3600 : now + 3600,
    };
  }

  async function signWithCurrentAlg(claims: JWTPayload): Promise<string> {
    switch (signAlg) {
      case "RS256": {
        await getOrCreateRsaJwk(); // ensures cachedRsaPrivateKey is populated
        return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "stub-rsa-1" }).sign(cachedRsaPrivateKey!);
      }
      case "ES256":
        return (await makeEs256Jwt(claims, { kid: "stub-es256-key-1" })).token;
      case "HS256": {
        const secret = await generateSecret("HS256", { extractable: true });
        return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).sign(secret);
      }
      case "none":
        // For AC7 negative tests: unsigned JWT (jose's UnsecuredJWT emits the alg=none header).
        return new UnsecuredJWT(claims).encode();
    }
  }

  // MSW handlers
  const handlers: HttpHandler[] = [
    // GET /.well-known/openid-configuration
    http.get(`${opts.issuer}/.well-known/openid-configuration`, () =>
      HttpResponse.json({
        issuer: opts.issuer,
        authorization_endpoint: `${opts.issuer}/authorize`,
        token_endpoint: `${opts.issuer}/token`,
        jwks_uri: `${opts.issuer}/jwks`,
        userinfo_endpoint: `${opts.issuer}/userinfo`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256", "ES256"],
        scopes_supported: ["openid", "profile", "email"],
      }),
    ),

    // GET /jwks
    http.get(`${opts.issuer}/jwks`, async () => {
      // Return public key(s) for verification — always the same key as used to sign tokens
      const jwk = await getOrCreateRsaJwk();
      return HttpResponse.json({
        keys: [jwk],
      });
    }),

    // GET /authorize — upstream authorization endpoint
    http.get(`${opts.issuer}/authorize`, ({ request }) => {
      const url = new URL(request.url);
      const state = url.searchParams.get("state") ?? "unknown-state";
      const nonce = url.searchParams.get("nonce") ?? "unknown-nonce";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";

      // Generate an upstream code and remember its nonce for the /token handler
      const upstreamCode = `upstream-code-${Math.random().toString(36).slice(2)}`;
      codeToNonce.set(upstreamCode, { nonce, state });

      // Redirect to our /oauth/callback with upstream authorization code
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", upstreamCode);
      callbackUrl.searchParams.set("state", state);

      return HttpResponse.redirect(callbackUrl, 302);
    }),

    // POST /token — upstream token endpoint. Accepts either
    // `client_secret_post` (credentials in body) or `client_secret_basic`
    // (credentials in Authorization header), mirroring real-world IdPs that
    // support both per RFC 6749 §2.3.1.
    http.post(`${opts.issuer}/token`, async ({ request }) => {
      const body = new URLSearchParams(await request.text());
      const code = body.get("code");

      let clientId = body.get("client_id");
      let clientSecret = body.get("client_secret");
      if (clientId === null || clientSecret === null) {
        const authHeader = request.headers.get("authorization");
        if (authHeader?.toLowerCase().startsWith("basic ")) {
          const decoded = Buffer.from(authHeader.slice("basic ".length), "base64").toString("utf-8");
          const colon = decoded.indexOf(":");
          if (colon > -1) {
            clientId = decodeURIComponent(decoded.slice(0, colon));
            clientSecret = decodeURIComponent(decoded.slice(colon + 1));
          }
        }
      }

      // Validate client credentials
      if (clientId !== opts.clientId || clientSecret !== opts.clientSecret) {
        return HttpResponse.json(
          { error: "invalid_client", error_description: "Client authentication failed" },
          { status: 401 },
        );
      }

      // Validate redirect_uri is present (RFC 6749 §4.1.3)
      const redirectUri = body.get("redirect_uri");
      if (!redirectUri) {
        return HttpResponse.json(
          { error: "invalid_request", error_description: "redirect_uri is required" },
          { status: 400 },
        );
      }

      // Look up the code and its associated nonce
      if (!code || !codeToNonce.has(code)) {
        return HttpResponse.json(
          { error: "invalid_grant", error_description: "Authorization code invalid" },
          { status: 400 },
        );
      }

      const { nonce } = codeToNonce.get(code)!;
      codeToNonce.delete(code); // consume the code (one-time use)

      let idToken: string;
      try {
        idToken = await signWithCurrentAlg(buildClaims(nextIdentity, nonce));
      } catch {
        return HttpResponse.json(
          { error: "server_error", error_description: "Token generation failed" },
          { status: 500 },
        );
      }

      return HttpResponse.json({
        access_token: `upstream-at-${Date.now()}`,
        token_type: "Bearer",
        id_token: idToken,
        expires_in: 3600,
      });
    }),
  ];

  return {
    handlers,
    issuer: opts.issuer,
    discoveryUrl: `${opts.issuer}/.well-known/openid-configuration`,
    authenticateNext(identity) {
      nextIdentity = { ...opts.defaultIdentity, ...identity };
    },
    expireNextToken() {
      expireNext = true;
    },
    signWithAlg(alg) {
      signAlg = alg;
      // Clear cached keypair so it's regenerated (relevant if alg changed back to RS256)
      cachedRsaJwk = null;
      cachedRsaPrivateKey = null;
    },
    resetOverrides() {
      nextIdentity = { ...opts.defaultIdentity };
      expireNext = false;
      signAlg = "RS256";
      cachedRsaJwk = null;
      cachedRsaPrivateKey = null;
      codeToNonce.clear();
    },
  };
}
