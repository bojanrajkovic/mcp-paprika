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
import { generateSecret, SignJWT, type JWK, type JWTPayload } from "jose";
import { makeRsaJwt, makeEs256Jwt } from "./jose-keys.js";

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

  // Cached keypair for RS256
  let cachedRsaJwk: JWK | null = null;
  let cachedRsaToken: string | null = null;

  /**
   * Gets or generates an RS256 keypair and signed token.
   * Caches to avoid regenerating per request.
   */
  async function getRsaToken(identity: typeof opts.defaultIdentity): Promise<{ token: string; jwk: JWK }> {
    const claims: JWTPayload = {
      iss: opts.issuer,
      sub: identity.sub,
      aud: opts.clientId,
      email: identity.email,
      email_verified: identity.emailVerified,
      nonce: "{{nonce}}", // placeholder; will be replaced in /authorize handler
      iat: Math.floor(Date.now() / 1000),
      exp: expireNext ? Math.floor(Date.now() / 1000) - 3600 : Math.floor(Date.now() / 1000) + 3600,
    };

    if (cachedRsaJwk === null) {
      const result = await makeRsaJwt(claims, { alg: "RS256", kid: "stub-rsa-key-1" });
      cachedRsaJwk = result.jwk;
      cachedRsaToken = result.token;
    }

    // Return the token with nonce replaced
    return {
      token: cachedRsaToken!.replace("{{nonce}}", identity.sub), // simple replacement for testing
      jwk: cachedRsaJwk,
    };
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
      // Return public key(s) for verification
      const rsaResult = await getRsaToken(opts.defaultIdentity);
      return HttpResponse.json({
        keys: [rsaResult.jwk],
      });
    }),

    // GET /authorize — upstream authorization endpoint
    http.get(`${opts.issuer}/authorize`, ({ request }) => {
      const url = new URL(request.url);
      const state = url.searchParams.get("state") ?? "unknown-state";
      const _nonce = url.searchParams.get("nonce") ?? "unknown-nonce";
      const redirectUri = url.searchParams.get("redirect_uri") ?? "";

      // Redirect to our /oauth/callback with upstream authorization code
      const callbackUrl = new URL(redirectUri);
      callbackUrl.searchParams.set("code", "upstream-code-stub");
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

      if (code !== "upstream-code-stub") {
        return HttpResponse.json(
          { error: "invalid_grant", error_description: "Authorization code invalid" },
          { status: 400 },
        );
      }

      // Generate id_token with the override identity and algorithm
      let idToken: string;
      try {
        switch (signAlg) {
          case "RS256": {
            const result = await getRsaToken(nextIdentity);
            idToken = result.token;
            break;
          }
          case "ES256": {
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
      // Clear cached token so it's regenerated with the new alg
      cachedRsaToken = null;
      cachedRsaJwk = null;
    },
    resetOverrides() {
      nextIdentity = { ...opts.defaultIdentity };
      expireNext = false;
      signAlg = "RS256";
      cachedRsaToken = null;
      cachedRsaJwk = null;
    },
  };
}
