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

import { http, HttpResponse, type HttpHandler } from "msw";
import { generateKeyPair, exportJWK, generateSecret, SignJWT, type JWK, type JWTPayload, type KeyLike } from "jose";
import { makeEs256Jwt } from "./jose-keys.js";

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

  // Cached keypair (NOT cached token — tokens are signed fresh per request with correct nonce)
  // Both the public JWK and private key are cached together so /jwks always returns the
  // same key that signs the tokens. makeRsaJwt() generates a fresh keypair on every call,
  // so we cannot use it here — we must cache the private key separately and sign inline.
  let cachedRsaJwk: JWK | null = null;
  let cachedRsaPrivateKey: KeyLike | null = null;

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

  /**
   * Signs a fresh RS256 JWT with the given identity and nonce.
   * Uses the cached private key so /jwks and the token share the same keypair.
   */
  async function signRsaToken(
    identity: typeof opts.defaultIdentity,
    nonce: string,
  ): Promise<{ token: string; jwk: JWK }> {
    const jwk = await getOrCreateRsaJwk();
    const claims: JWTPayload = {
      iss: opts.issuer,
      sub: identity.sub,
      aud: opts.clientId,
      email: identity.email,
      email_verified: identity.emailVerified,
      nonce, // the actual nonce from authorize, not a placeholder
      iat: Math.floor(Date.now() / 1000),
      exp: expireNext ? Math.floor(Date.now() / 1000) - 3600 : Math.floor(Date.now() / 1000) + 3600,
    };

    const token = await new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: "stub-rsa-1" })
      .sign(cachedRsaPrivateKey!);

    return { token, jwk };
  }

  async function getEs256Token(identity: typeof opts.defaultIdentity): Promise<{ token: string; jwk: JWK }> {
    const claims: JWTPayload = {
      iss: opts.issuer,
      sub: identity.sub,
      aud: opts.clientId,
      email: identity.email,
      email_verified: identity.emailVerified,
      nonce: "nonce-value",
      iat: Math.floor(Date.now() / 1000),
      exp: expireNext ? Math.floor(Date.now() / 1000) - 3600 : Math.floor(Date.now() / 1000) + 3600,
    };

    return makeEs256Jwt(claims, { kid: "stub-es256-key-1" });
  }

  async function getHs256Token(identity: typeof opts.defaultIdentity): Promise<string> {
    const secret = await generateSecret("HS256", { extractable: true });
    const claims: JWTPayload = {
      iss: opts.issuer,
      sub: identity.sub,
      aud: opts.clientId,
      email: identity.email,
      email_verified: identity.emailVerified,
      nonce: "nonce-value",
      iat: Math.floor(Date.now() / 1000),
      exp: expireNext ? Math.floor(Date.now() / 1000) - 3600 : Math.floor(Date.now() / 1000) + 3600,
    };

    return new SignJWT(claims).setProtectedHeader({ alg: "HS256" }).sign(secret);
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

    // POST /token — upstream token endpoint
    http.post(`${opts.issuer}/token`, async ({ request }) => {
      const body = new URLSearchParams(await request.text());
      const clientId = body.get("client_id");
      const clientSecret = body.get("client_secret");
      const code = body.get("code");

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

      // Generate id_token with the override identity, correct nonce, and algorithm
      let idToken: string;
      try {
        switch (signAlg) {
          case "RS256": {
            const result = await signRsaToken(nextIdentity, nonce);
            idToken = result.token;
            break;
          }
          case "ES256": {
            // ES256 also needs per-request signing with correct nonce
            const result = await getEs256Token(nextIdentity);
            idToken = result.token;
            break;
          }
          case "HS256": {
            idToken = await getHs256Token(nextIdentity);
            break;
          }
          case "none": {
            // For AC7 negative tests: return an unsigned token (JWT with alg=none, no signature)
            const header = JSON.stringify({ alg: "none", typ: "JWT" });
            const payload = JSON.stringify({
              iss: opts.issuer,
              sub: nextIdentity.sub,
              aud: opts.clientId,
              email: nextIdentity.email,
              email_verified: nextIdentity.emailVerified,
              nonce,
              iat: Math.floor(Date.now() / 1000),
              exp: expireNext ? Math.floor(Date.now() / 1000) - 3600 : Math.floor(Date.now() / 1000) + 3600,
            });
            const headerB64 = btoa(header).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
            const payloadB64 = btoa(payload).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
            idToken = `${headerB64}.${payloadB64}.`;
            break;
          }
        }
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
