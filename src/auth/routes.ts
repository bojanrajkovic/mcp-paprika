import { toMessage } from "../utils/log.js";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { z } from "zod";
import type { DiskClientRegistrationStore } from "./client-registration.js";
import type { TokenStore } from "./token-store.js";
import type { AuthRequestStore } from "./auth-request-store.js";
import type { AuthCodeStore } from "./auth-code-store.js";
import type { ResolvedOAuthConfig } from "./types.js";
import type { DiscoveryDoc } from "./oidc-client.js";
import type { JWTVerifyGetKey } from "jose";
import type { DiskCache } from "../cache/disk-cache.js";
import { generateOpaqueToken, nowSeconds } from "./tokens.js";
import { verifyIdToken } from "./oidc-client.js";
import type { IdTokenPayload } from "./types.js";
import { verifyIdentity } from "./allowlist.js";
import { OAuthMetadataValidationError } from "./errors.js";

export interface AuthRoutesDeps {
  readonly clientStore: DiskClientRegistrationStore;
  readonly tokenStore: TokenStore;
  readonly authRequests: AuthRequestStore;
  readonly authCodes: AuthCodeStore;
  readonly oidcConfig: ResolvedOAuthConfig;
  readonly discovery: DiscoveryDoc;
  readonly jwks: JWTVerifyGetKey;
  readonly publicUrl: string;
}

/**
 * Builds custom auth routes not mounted by @hono/mcp:
 * - GET /oauth/callback — upstream IdP redirect callback
 * - PUT /register/{client_id} — RFC 7592 client metadata update
 * - DELETE /register/{client_id} — RFC 7592 client delete + cascade
 */
export function buildAuthRoutes(deps: AuthRoutesDeps): Hono {
  const app = new Hono();

  // GET /oauth/callback — upstream IdP callback leg
  app.get("/oauth/callback", async (c) => {
    const code = c.req.query("code");
    const ourState = c.req.query("state");
    const upstreamError = c.req.query("error");
    const upstreamErrorDescription = c.req.query("error_description");

    if (typeof ourState !== "string") return c.text("missing state parameter", 400);
    const stored = deps.authRequests.consume(ourState);
    if (stored === null) return c.text("unknown or expired state", 400);

    // Upstream error path — AC2.14 (iss on error redirect)
    if (upstreamError !== undefined) {
      return redirectToClient(c, stored.redirectUri, {
        error: upstreamError,
        error_description: upstreamErrorDescription,
        state: stored.claudeState,
        iss: deps.publicUrl,
      });
    }

    if (typeof code !== "string") return c.text("missing code parameter", 400);

    // Exchange upstream code for upstream id_token. Pick the auth method
    // advertised by discovery — IdPs that require `client_secret_basic`
    // (Entra and some Okta tenants) fail every login if we always post the
    // secret in the body, so we pick from `token_endpoint_auth_methods_supported`
    // and only fall through to post when the field is absent / unrecognized.
    let idToken: string;
    try {
      const authMethod = pickTokenAuthMethod(deps.discovery.token_endpoint_auth_methods_supported);
      const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${deps.publicUrl}/oauth/callback`,
      });
      if (authMethod === "basic") {
        // RFC 6749 §2.3.1: client_id and client_secret are application/x-www-form-urlencoded
        // (percent-encoded) BEFORE being concatenated with ":" and base64-encoded.
        const userpass = `${encodeURIComponent(deps.oidcConfig.clientId)}:${encodeURIComponent(deps.oidcConfig.clientSecret)}`;
        headers["authorization"] = `Basic ${Buffer.from(userpass, "utf-8").toString("base64")}`;
      } else {
        tokenBody.set("client_id", deps.oidcConfig.clientId);
        tokenBody.set("client_secret", deps.oidcConfig.clientSecret);
      }
      const tokenRes = await fetch(deps.discovery.token_endpoint, {
        method: "POST",
        headers,
        body: tokenBody,
      });
      if (!tokenRes.ok) {
        throw new Error(`token endpoint returned ${tokenRes.status}`);
      }
      const tokenJson = await tokenRes.json();

      // Validate token response shape
      const TokenResponseSchema = z.object({
        id_token: z.string(),
        access_token: z.string().optional(),
        token_type: z.string().optional(),
        expires_in: z.number().optional(),
      });

      const validated = TokenResponseSchema.safeParse(tokenJson);
      if (!validated.success) {
        throw new Error("token endpoint response missing id_token");
      }
      idToken = validated.data.id_token;
    } catch (cause) {
      process.stderr.write(`[auth] upstream token exchange failed: ${toMessage(cause)}\n`);
      return redirectToClient(c, stored.redirectUri, {
        error: "server_error",
        error_description: "upstream code exchange failed",
        state: stored.claudeState,
        iss: deps.publicUrl,
      });
    }

    // Verify id_token (alg, sig, iss, aud, nonce)
    let payload: IdTokenPayload;
    try {
      payload = await verifyIdToken(idToken, deps.jwks, {
        clientId: deps.oidcConfig.clientId,
        issuer: deps.discovery.issuer,
        nonce: stored.ourNonce,
        allowedAlgs: deps.oidcConfig.allowedAlgs,
      });
    } catch (cause) {
      process.stderr.write(`[auth] id_token verification failed: ${toMessage(cause)}\n`);
      return redirectToClient(c, stored.redirectUri, {
        error: "access_denied",
        error_description: "id_token verification failed",
        state: stored.claudeState,
        iss: deps.publicUrl,
      });
    }

    // Allowlist check
    const identityResult = verifyIdentity(payload, deps.oidcConfig.emailVerifiedPolicy, {
      emails: new Set(deps.oidcConfig.allowlist.emails),
      subs: new Set(deps.oidcConfig.allowlist.subs),
    });

    return identityResult.match(
      async (identity) => {
        const ourAuthCode = generateOpaqueToken("mcp_ac_");
        deps.authCodes.put(ourAuthCode, {
          clientId: stored.clientId,
          codeChallenge: stored.codeChallenge,
          codeChallengeMethod: "S256",
          redirectUri: stored.redirectUri,
          resource: stored.resource,
          scope: stored.scope,
          identity,
          createdAt: nowSeconds(),
        });
        return redirectToClient(c, stored.redirectUri, {
          code: ourAuthCode,
          state: stored.claudeState,
          iss: deps.publicUrl, // AC2.14 — iss on success redirect
        });
      },
      (denial) => {
        // AC3.4: deny alert — log identity claims only, never the id_token.
        // The full denial reason (including email/sub) goes to operator stderr;
        // the redirect-back error_description is generic so we don't leak the
        // user's email or subject id through claude.ai (or the user's browser
        // history) on a denial.
        process.stderr.write(
          `[auth] allowlist denial: ${denial.message} email=${denial.identity.email ?? "-"} sub=${denial.identity.sub ?? "-"}\n`,
        );
        return redirectToClient(c, stored.redirectUri, {
          error: "access_denied",
          error_description: "identity not allowed by server policy",
          state: stored.claudeState,
          iss: deps.publicUrl,
        });
      },
    );
  });

  // PUT /register/{client_id} — RFC 7592 update
  app.put("/register/:clientId", async (c) => {
    const clientId = c.req.param("clientId");
    const denied = await verifyRatBearer(c, deps.clientStore, clientId);
    if (denied) return denied;

    try {
      const body = await c.req.json();
      const updated = await deps.clientStore.updateClient(clientId, body);
      return c.json(updated, 200);
    } catch (e) {
      if (e instanceof OAuthMetadataValidationError) {
        return c.json({ error: "invalid_client_metadata", error_description: e.message }, 400);
      }
      throw e;
    }
  });

  // DELETE /register/{client_id} — RFC 7592 delete + cascade
  app.delete("/register/:clientId", async (c) => {
    const clientId = c.req.param("clientId");
    const denied = await verifyRatBearer(c, deps.clientStore, clientId);
    if (denied) return denied;

    await deps.tokenStore.removeAllForClient(clientId); // cascade FIRST
    await deps.clientStore.deleteClient(clientId);
    return c.body(null, 204);
  });

  return app;
}

/**
 * Verify Registration Access Token (RAT) Bearer token and return null if valid,
 * or a 401 response if invalid/missing.
 */
async function verifyRatBearer(
  c: Context,
  store: DiskClientRegistrationStore,
  clientId: string,
): Promise<Response | null> {
  const auth = c.req.header("authorization");
  // RFC 6750 §2.1: the Bearer scheme is case-insensitive.
  const match = auth?.match(/^bearer\s+(.+)$/i);
  if (!match) return c.json({ error: "unauthorized" }, 401);

  const presented = match[1]!;
  const ok = await store.verifyRegistrationAccessToken(clientId, presented);
  if (!ok) return c.json({ error: "unauthorized" }, 401);

  return null;
}

/**
 * Helper to redirect to client with params, always including iss for AC2.14.
 * Both success and error paths include iss.
 */
function redirectToClient(c: Context, redirectUri: string, params: Record<string, string | undefined>): Response {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) u.searchParams.set(k, v);
  }
  return c.redirect(u.toString(), 302);
}

/**
 * Hard cap on the number of registered DCR clients. Both the fast-path
 * `buildClientCap` middleware (non-atomic 429 rejection) and the authoritative
 * atomic check inside `DiskClientRegistrationStore.registerClient` read from
 * this single constant so they can't drift apart.
 */
export const MAX_REGISTERED_CLIENTS = 50;

/**
 * Pick the upstream token-endpoint authentication method based on the IdP's
 * discovery metadata.
 *
 * - If the IdP advertises `client_secret_post`, use it (widest IdP support;
 *   what Google/Entra/Okta/Auth0/Keycloak presets actually advertise).
 * - Else if it advertises `client_secret_basic`, use Basic — required by
 *   compliant IdPs that don't support post (some Entra/Okta tenants default
 *   to Basic only).
 * - If discovery doesn't include the field at all, fall back to **Basic**.
 *   RFC 8414 makes the field optional and RFC 6749 §2.3.1 specifies that
 *   every spec-compliant authorization server MUST accept HTTP Basic auth at
 *   the token endpoint. Defaulting to post was non-compliant for IdPs whose
 *   discovery is silent and that only accept Basic — every such login would
 *   fail at callback time.
 *
 * Exported for unit testing.
 */
export function pickTokenAuthMethod(supported: ReadonlyArray<string> | undefined): "post" | "basic" {
  if (supported === undefined || supported.length === 0) return "basic";
  if (supported.includes("client_secret_post")) return "post";
  if (supported.includes("client_secret_basic")) return "basic";
  // Discovery advertises only methods we don't support (private_key_jwt,
  // tls_client_auth, none, …). Best effort: Basic, per RFC 6749 §2.3.1's
  // "MUST support Basic" requirement on compliant servers. The request will
  // still likely fail and /oauth/callback's catch-all logs `upstream code
  // exchange failed`, but trying the spec-mandated method is better than
  // attempting one neither side promised to support.
  return "basic";
}

/**
 * Rate-limit middleware for DCR (POST /register). 10 requests / hour / IP.
 *
 * `trustProxy` controls how the per-request key is derived:
 * - `true` — honor `x-forwarded-for` (leftmost) then `cf-connecting-ip`,
 *   falling back to the connection's remote address. Use only behind a
 *   reverse proxy that sanitizes those headers (Tailscale Funnel, an
 *   ingress controller, Cloudflare, etc.); otherwise an attacker can spoof
 *   a fresh address per request and trivially bypass the limit.
 * - `false` — derive the key from the connection's remote address only.
 *   This is the safe default for a direct-exposed server; behind a proxy
 *   it lumps every request under the proxy's address, so flip to `true`
 *   once a trusted proxy is in place.
 */
export function buildDcrRateLimit(options: { readonly trustProxy: boolean }): MiddlewareHandler {
  const inner = rateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    limit: 10,
    keyGenerator: (c) => {
      if (options.trustProxy) {
        // RFC 7239: x-forwarded-for is comma-separated; take the leftmost (client IP).
        const xForwardedFor = c.req.header("x-forwarded-for");
        if (xForwardedFor) {
          const first = xForwardedFor.split(",")[0]?.trim();
          if (first) return first;
        }
        const cf = c.req.header("cf-connecting-ip");
        if (cf) return cf;
      }
      return getRemoteAddress(c) ?? "unknown";
    },
    standardHeaders: "draft-6",
  });
  // Hono mounts the middleware on the `/register` prefix, but RFC 7592
  // `PUT /register/:clientId` (update) and `DELETE /register/:clientId`
  // (delete) share that prefix. Without the gate, those legitimate
  // client-management calls also burn the 10/hr bucket and start returning
  // 429 once a single client has been registered enough. Mirrors the same
  // gate buildClientCap applies.
  return async (c, next) => {
    if (c.req.path !== "/register" || c.req.method !== "POST") return next();
    return inner(c, next);
  };
}

/**
 * Read the connection's remote address from the underlying node:http
 * IncomingMessage that `@hono/node-server` attaches to `c.env`. Returns
 * `null` when running under a Hono adapter that doesn't expose it (e.g.
 * `app.request()` in tests, or non-Node adapters).
 */
function getRemoteAddress(c: Context): string | null {
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? null;
}

/**
 * Client cap middleware for DCR.
 * Returns 429 if the server has reached the max registered clients.
 * Only runs on POST /register.
 *
 * This is a non-atomic read-before-write — under concurrent registration
 * traffic, two requests can both observe a pre-cap count, both pass the
 * middleware, and both proceed to registration. The authoritative atomic
 * cap is enforced inside `DiskClientRegistrationStore.registerClient` (under
 * `DiskCache`'s write mutex), which throws `InvalidRequestError` on overflow.
 * This middleware exists as a fast-path 429 for the common single-request
 * case where the cap is obviously hit; the atomic store check closes the
 * race window for the rest.
 */
export function buildClientCap(cache: DiskCache, max: number): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.path !== "/register" || c.req.method !== "POST") return next();

    const clients = await cache.getAllOAuthClients();
    if (clients.length >= max) {
      return c.json({ error: "invalid_request", error_description: "client registration cap reached" }, 429);
    }
    await next();
  };
}
