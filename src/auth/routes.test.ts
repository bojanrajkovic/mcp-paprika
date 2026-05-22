import { describe, it, expect, beforeEach, vi } from "vitest";
import pino from "pino";
import { nowSeconds } from "./tokens.js";
import { makePinoCapture } from "../tools/tool-test-utils.js";
import { Hono } from "hono";
import {
  buildAuthRoutes,
  buildDcrRateLimit,
  buildClientCap,
  pickTokenAuthMethod,
  type AuthRoutesDeps,
} from "./routes.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { TokenStore } from "./token-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { DiskCache } from "../cache/disk-cache.js";
import { makeDefaultOidcStub, makeDiscoveryDoc } from "./__fixtures__/oidc-stub.js";
import { OAuthClientNotFoundError } from "./errors.js";
import { makeVerifiedIdentity } from "./__fixtures__/oauth-state.js";
import { createJwksFor } from "./oidc-client.js";
import type { JWTVerifyGetKey } from "jose";
import { useMswServer } from "../__fixtures__/msw.js";

// Pino numeric log levels for use in assertions (see pino docs: info=30, warn=40, error=50)
const warnLevel = 40;

// ============================================================================
// F6: makeRoutesConfig — deduplicated buildAuthRoutes config factory
// ============================================================================

type RoutesCtx = {
  clientStore: DiskClientRegistrationStore;
  tokenStore: TokenStore;
  authRequests: AuthRequestStore;
  authCodes: AuthCodeStore;
  oidcStubIssuer: string;
};

type RoutesOverrides = {
  jwks?: JWTVerifyGetKey;
  authRequests?: AuthRequestStore;
  authCodes?: AuthCodeStore;
};

function makeRoutesConfig(ctx: RoutesCtx, overrides: RoutesOverrides = {}): AuthRoutesDeps {
  return {
    clientStore: ctx.clientStore,
    tokenStore: ctx.tokenStore,
    authRequests: overrides.authRequests ?? ctx.authRequests,
    authCodes: overrides.authCodes ?? ctx.authCodes,
    oidcConfig: {
      clientId: "stub-client-id",
      clientSecret: "stub-client-secret",
      discoveryUrl: `${ctx.oidcStubIssuer}/.well-known/openid-configuration`,
      publicUrl: "https://mcp.example.com",
      presetName: null,
      scopes: ["openid", "email"],
      emailVerifiedPolicy: "if-present",
      trustProxy: true,
      allowlist: { emails: ["user@example.com"], subs: [] },
      allowedAlgs: ["RS256"],
    },
    discovery: makeDiscoveryDoc(ctx.oidcStubIssuer),
    jwks: overrides.jwks ?? ((async () => ({ keys: [] })) as unknown as JWTVerifyGetKey),
    publicUrl: "https://mcp.example.com",
    log: { auth: pino({ level: "silent" }), oidcClient: pino({ level: "silent" }) },
  };
}

// Created at module scope so handlers can be passed as permanent initial handlers
// to useMswServer (permanent = not removed by resetHandlers).
const oidcStub = makeDefaultOidcStub();

describe("Auth Routes", () => {
  let cache: DiskCache;
  let app: Hono;
  let authRequests: AuthRequestStore;
  let authCodes: AuthCodeStore;
  let clientStore: DiskClientRegistrationStore;
  let tokenStore: TokenStore;

  // useMswServer wires beforeAll(listen) + afterEach(resetHandlers + onReset) + afterAll(close).
  // oidcStub.handlers are passed as permanent handlers so resetHandlers() preserves them.
  const msw = useMswServer([...oidcStub.handlers], { onReset: () => oidcStub.resetOverrides() });

  beforeEach(async () => {
    const cacheDir = `/tmp/test-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cache = new DiskCache(cacheDir);
    await cache.init();

    clientStore = new DiskClientRegistrationStore(cache, "https://mcp.example.com", pino({ level: "silent" }));
    tokenStore = new TokenStore(cache);
    authRequests = new AuthRequestStore();
    authCodes = new AuthCodeStore();

    // Setup Hono app with routes
    app = new Hono();

    app.route(
      "/",
      buildAuthRoutes(
        makeRoutesConfig({ clientStore, tokenStore, authRequests, authCodes, oidcStubIssuer: oidcStub.issuer }),
      ),
    );
  });

  describe("GET /oauth/callback", () => {
    it("AC2.14: error redirect includes iss on upstream error", async () => {
      // PLAN says (phase_06.md:668-672): `app.request("/oauth/callback?error=access_denied&state=<ourState>")`. Status=302, `iss` in location query, `error=access_denied`.
      const ourState = "mcp_state_error_test";
      const claudeState = "claude_state_error";
      authRequests.put(ourState, {
        clientId: "stub-client-id",
        codeChallenge: "test-challenge",
        codeChallengeMethod: "S256",
        redirectUri: "https://claude.ai/callback",
        resource: "https://mcp.example.com/",
        claudeState,
        scope: "openid email",
        ourNonce: "mcp_nonce_error",
        createdAt: nowSeconds(),
      });

      const res = await app.request(
        `/oauth/callback?error=access_denied&error_description=user_denied&state=${ourState}`,
      );

      expect(res.status).toBe(302);
      const location = res.headers.get("location");
      expect(location).toBeTruthy();

      const redirectUrl = new URL(location!);
      expect(redirectUrl.searchParams.get("iss")).toBe("https://mcp.example.com");
      expect(redirectUrl.searchParams.get("error")).toBe("access_denied");
      expect(redirectUrl.searchParams.get("state")).toBe(claudeState);
    });

    it("AC2.14: success redirect includes iss=<MCP_PUBLIC_URL>", async () => {
      // PLAN says (phase_06.md:662-667): successful upstream code exchange → allowlist OK → mints mcp_ac_ → redirects with code+state+iss
      // Build a local app with realJwks so verifyIdToken can fetch the key from the MSW stub's /jwks endpoint.
      // The outer beforeEach app uses `jwks: async () => ({ keys: [] })` which would fail sig verification.
      const realJwks = createJwksFor(makeDiscoveryDoc(oidcStub.issuer));

      const localAuthRequests = new AuthRequestStore();
      const localAuthCodes = new AuthCodeStore();
      const localApp = new Hono();
      localApp.route(
        "/",
        buildAuthRoutes(
          makeRoutesConfig(
            { clientStore, tokenStore, authRequests, authCodes, oidcStubIssuer: oidcStub.issuer },
            { jwks: realJwks, authRequests: localAuthRequests, authCodes: localAuthCodes },
          ),
        ),
      );

      // Seed the local AuthRequestStore with a known state+nonce pair
      const ourState = "mcp_state_success_test";
      const ourNonce = "mcp_nonce_success_test";
      localAuthRequests.put(ourState, {
        clientId: "stub-client-id",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        redirectUri: "https://claude.ai/callback",
        resource: "https://mcp.example.com/",
        claudeState: "claude_state_success",
        scope: "openid email",
        ourNonce,
        createdAt: nowSeconds(),
      });

      // Drive the stub's /authorize so codeToNonce records ourNonce for the generated code
      const authResp = await fetch(
        `${oidcStub.issuer}/authorize?nonce=${ourNonce}&state=${ourState}&redirect_uri=https://mcp.example.com/oauth/callback`,
        { redirect: "manual" },
      );
      const upstreamCode = new URL(authResp.headers.get("location")!).searchParams.get("code")!;

      // Drive the callback route — MSW intercepts the outbound /token and /jwks calls
      const res = await localApp.request(`/oauth/callback?code=${upstreamCode}&state=${ourState}`);

      expect(res.status).toBe(302);
      const location = res.headers.get("location");
      expect(location).toBeTruthy();

      const loc = new URL(location!);
      expect(loc.origin + loc.pathname).toBe("https://claude.ai/callback");
      expect(loc.searchParams.get("iss")).toBe("https://mcp.example.com");
      expect(loc.searchParams.get("state")).toBe("claude_state_success");
      expect(loc.searchParams.get("code")).toMatch(/^mcp_ac_/);
    });

    it("RFC 8414: uses HTTP Basic auth at upstream /token when discovery advertises only client_secret_basic", async () => {
      // The IdP doc here only lists `client_secret_basic`. /oauth/callback must
      // honor that and authenticate via Authorization: Basic — sending the
      // secret in the body fails compliant IdPs like some Entra/Okta tenants.
      // We capture the outbound request via an MSW handler override and assert
      // both that the header is present AND that no `client_secret` appears in
      // the body (the previous failure mode).
      const realJwks = createJwksFor(makeDiscoveryDoc(oidcStub.issuer));

      let capturedAuth: string | null | undefined;
      let bodyHadSecret = true;
      msw.use(
        // Async import isn't allowed in the message body — use a module-scope import.
        (await import("msw")).http.post(`${oidcStub.issuer}/token`, async ({ request }) => {
          capturedAuth = request.headers.get("authorization");
          const body = new URLSearchParams(await request.clone().text());
          bodyHadSecret = body.has("client_secret");
          if (capturedAuth?.toLowerCase().startsWith("basic ")) {
            // Hand back to the existing stub by issuing a sub-request — simpler
            // to mirror the stub's success path inline since we control the
            // assertions on the way out.
            return undefined; // fall through to the permanent handler
          }
          // Not Basic — the bug Codex flagged. Fail loudly so the test reports it.
          const { HttpResponse } = await import("msw");
          return HttpResponse.json({ error: "invalid_client" }, { status: 401 });
        }),
      );

      const localAuthRequests = new AuthRequestStore();
      const localAuthCodes = new AuthCodeStore();
      const basicOnlyDiscovery = {
        ...makeDiscoveryDoc(oidcStub.issuer),
        token_endpoint_auth_methods_supported: ["client_secret_basic"],
      };
      const localApp = new Hono();
      localApp.route(
        "/",
        buildAuthRoutes({
          ...makeRoutesConfig(
            { clientStore, tokenStore, authRequests, authCodes, oidcStubIssuer: oidcStub.issuer },
            { jwks: realJwks, authRequests: localAuthRequests, authCodes: localAuthCodes },
          ),
          discovery: basicOnlyDiscovery,
        }),
      );

      const ourState = "mcp_state_basic_test";
      const ourNonce = "mcp_nonce_basic_test";
      localAuthRequests.put(ourState, {
        clientId: "stub-client-id",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        redirectUri: "https://claude.ai/callback",
        resource: "https://mcp.example.com/",
        claudeState: "claude_state_basic",
        scope: "openid email",
        ourNonce,
        createdAt: nowSeconds(),
      });

      const authResp = await fetch(
        `${oidcStub.issuer}/authorize?nonce=${ourNonce}&state=${ourState}&redirect_uri=https://mcp.example.com/oauth/callback`,
        { redirect: "manual" },
      );
      const upstreamCode = new URL(authResp.headers.get("location")!).searchParams.get("code")!;

      const res = await localApp.request(`/oauth/callback?code=${upstreamCode}&state=${ourState}`);

      expect(res.status).toBe(302);
      const location = res.headers.get("location");
      const loc = new URL(location!);
      expect(loc.searchParams.get("code")).toMatch(/^mcp_ac_/); // success path

      expect(capturedAuth).toMatch(/^Basic\s+[A-Za-z0-9+/=]+$/);
      expect(bodyHadSecret).toBe(false);

      // Decode the Basic header to confirm the credentials are the configured
      // pair, properly form-urlencoded per RFC 6749 §2.3.1.
      const decoded = Buffer.from(capturedAuth!.slice("Basic ".length), "base64").toString("utf-8");
      const [u, p] = decoded.split(":");
      expect(decodeURIComponent(u!)).toBe("stub-client-id");
      expect(decodeURIComponent(p!)).toBe("stub-client-secret");
    });

    it("AC3.4: does NOT log id_token, only identity claims, on denial", async () => {
      // PLAN says (phase_06.md:680-686): allowlist denial logs identity claims (email, sub) but never id_token.
      // Build a local app with realJwks so verifyIdToken passes, then hit allowlist denial.
      // Only user@example.com is on the allowlist — unknown@example.com will be denied.
      const realJwks = createJwksFor(makeDiscoveryDoc(oidcStub.issuer));

      // Capture pino records from the auth component logger (denial path uses auth, not oidcClient).
      // Mirror src/auth/build.ts: production passes parentLog.child({ component: "auth" }) so
      // records carry the component field. Wrapping here locks that contract in.
      const { log: captureLog, records } = makePinoCapture();
      const authLog = captureLog.child({ component: "auth" });

      const localAuthRequests = new AuthRequestStore();
      const localAuthCodes = new AuthCodeStore();
      const localApp = new Hono();
      localApp.route(
        "/",
        buildAuthRoutes({
          ...makeRoutesConfig(
            { clientStore, tokenStore, authRequests, authCodes, oidcStubIssuer: oidcStub.issuer },
            { jwks: realJwks, authRequests: localAuthRequests, authCodes: localAuthCodes },
          ),
          log: { auth: authLog, oidcClient: pino({ level: "silent" }) },
        }),
      );

      // Override the stub identity to one not on the allowlist
      oidcStub.authenticateNext({ email: "unknown@example.com", sub: "unknown-sub-999", emailVerified: true });

      // Seed the local AuthRequestStore
      const ourState = "mcp_state_denial_test";
      const ourNonce = "mcp_nonce_denial_test";
      localAuthRequests.put(ourState, {
        clientId: "stub-client-id",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        redirectUri: "https://claude.ai/callback",
        resource: "https://mcp.example.com/",
        claudeState: "claude_state_denial",
        scope: "openid email",
        ourNonce,
        createdAt: nowSeconds(),
      });

      // Drive /authorize to register the nonce in the stub's codeToNonce map
      const authResp = await fetch(
        `${oidcStub.issuer}/authorize?nonce=${ourNonce}&state=${ourState}&redirect_uri=https://mcp.example.com/oauth/callback`,
        { redirect: "manual" },
      );
      const upstreamCode = new URL(authResp.headers.get("location")!).searchParams.get("code")!;

      // Drive the callback route
      const res = await localApp.request(`/oauth/callback?code=${upstreamCode}&state=${ourState}`);

      // Should redirect with error=access_denied and iss
      expect(res.status).toBe(302);
      const location = res.headers.get("location");
      expect(location).toBeTruthy();
      const loc = new URL(location!);
      expect(loc.searchParams.get("error")).toBe("access_denied");
      expect(loc.searchParams.get("iss")).toBe("https://mcp.example.com");

      // Denial redirects MUST NOT leak identity claims back to the client —
      // these go onto a URL forwarded to claude.ai. The full claims live in
      // the operator log (asserted below); the on-the-wire copy is a generic message.
      const description = loc.searchParams.get("error_description") ?? "";
      expect(description).not.toContain("unknown@example.com");
      expect(description).not.toContain("unknown-sub-999");

      // AC3.4: id_token must NOT appear in captured log records (JWTs start with "eyJ")
      expect(JSON.stringify(records)).not.toMatch(/eyJ/);

      // AC3.4: identity claims MUST appear in the denial log record as structured fields,
      // and the record must carry component: "auth" (mirrors src/auth/build.ts child logger).
      expect(records).toContainEqual(
        expect.objectContaining({
          msg: "allowlist denied identity",
          level: warnLevel,
          component: "auth",
          email: "unknown@example.com",
          sub: "unknown-sub-999",
        }),
      );
    });

    it("AC9.6: emits info record on allowlist hit", async () => {
      // Build a local app wired to a capture logger so we can assert on the
      // "allowlist accepted identity" record emitted in the success branch.
      const realJwks = createJwksFor(makeDiscoveryDoc(oidcStub.issuer));

      // Mirror src/auth/build.ts: production passes parentLog.child({ component: "auth" }) so
      // records carry the component field. Wrapping here locks that contract in.
      const { log: captureLog, records } = makePinoCapture();
      const authLog = captureLog.child({ component: "auth" });

      const localAuthRequests = new AuthRequestStore();
      const localAuthCodes = new AuthCodeStore();
      const localApp = new Hono();
      localApp.route(
        "/",
        buildAuthRoutes({
          ...makeRoutesConfig(
            { clientStore, tokenStore, authRequests, authCodes, oidcStubIssuer: oidcStub.issuer },
            { jwks: realJwks, authRequests: localAuthRequests, authCodes: localAuthCodes },
          ),
          log: { auth: authLog, oidcClient: pino({ level: "silent" }) },
        }),
      );

      // Seed the local AuthRequestStore with an allowlisted user's nonce
      const ourState = "mcp_state_accept_test";
      const ourNonce = "mcp_nonce_accept_test";
      localAuthRequests.put(ourState, {
        clientId: "stub-client-id",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        redirectUri: "https://claude.ai/callback",
        resource: "https://mcp.example.com/",
        claudeState: "claude_state_accept",
        scope: "openid email",
        ourNonce,
        createdAt: nowSeconds(),
      });

      // Drive /authorize to register the nonce in the stub's codeToNonce map
      const authResp = await fetch(
        `${oidcStub.issuer}/authorize?nonce=${ourNonce}&state=${ourState}&redirect_uri=https://mcp.example.com/oauth/callback`,
        { redirect: "manual" },
      );
      const upstreamCode = new URL(authResp.headers.get("location")!).searchParams.get("code")!;

      // Drive the callback — user@example.com is on the allowlist
      const res = await localApp.request(`/oauth/callback?code=${upstreamCode}&state=${ourState}`);

      // Should redirect successfully with code+iss
      expect(res.status).toBe(302);
      const location = res.headers.get("location");
      const loc = new URL(location!);
      expect(loc.searchParams.get("error")).toBeNull();
      expect(loc.searchParams.get("iss")).toBe("https://mcp.example.com");

      // AC9.6: info record must be emitted for the accepted identity, and must carry
      // component: "auth" (mirrors src/auth/build.ts child logger contract).
      expect(records).toContainEqual(
        expect.objectContaining({
          level: 30, // info
          msg: "allowlist accepted identity",
          component: "auth",
          email: "user@example.com",
          sub: expect.any(String),
        }),
      );
    });

    it("missing state → 400", async () => {
      const res = await app.request("/oauth/callback");
      expect(res.status).toBe(400);
      expect(await res.text()).toContain("missing state");
    });
  });

  describe("RFC 7592 PUT /register/{clientId}", () => {
    it("AC2.7: correct RAT updates metadata; 200 with full doc + registration_client_uri", async () => {
      // PLAN says (phase_06.md:674): Register a client via `clientStore.registerClient(...)` to get the RAT (registration_access_token). Call PUT `/register/<clientId>` with `Authorization: Bearer <RAT>` header and a JSON body containing updated metadata (`client_name`). Assert status=200, JSON body has new client_name + registration_client_uri.
      const registered = await clientStore.registerClient({
        client_name: "Original Name",
        redirect_uris: ["https://claude.ai/callback"],
      });

      const rat = registered.registration_access_token;
      const clientId = registered.client_id;

      const res = await app.request(`/register/${clientId}`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${rat}`,
        },
        body: JSON.stringify({ client_name: "Updated Name" }),
      });

      expect(res.status).toBe(200);
      const json = (await res.json()) as Record<string, unknown>;
      expect(json["client_name"]).toBe("Updated Name");
      expect(json["registration_client_uri"]).toBe(`https://mcp.example.com/register/${clientId}`);
    });

    it("AC2.12: missing Authorization → 401", async () => {
      const res = await app.request("/register/test-client-id", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ client_name: "Updated" }),
      });
      expect(res.status).toBe(401);
    });

    it("races a concurrent DELETE to 404, not 500", async () => {
      // The race: verifyRatBearer's lookup passes (client + RAT present), then
      // a concurrent DELETE /register/:id removes the client record, then
      // updateClient throws OAuthClientNotFoundError. The previous handler
      // only mapped OAuthMetadataValidationError and rethrew everything else,
      // turning this benign concurrent condition into a 500. The handler now
      // catches the not-found case and returns 404.
      //
      // Deterministically simulating the race: stub the verifyRegistrationAccessToken
      // path to pass, but have updateClient throw OAuthClientNotFoundError.
      const verifySpy = vi.spyOn(clientStore, "verifyRegistrationAccessToken").mockResolvedValue(true);
      const updateSpy = vi
        .spyOn(clientStore, "updateClient")
        .mockRejectedValue(OAuthClientNotFoundError.forId("ghost-client"));

      try {
        const res = await app.request("/register/ghost-client", {
          method: "PUT",
          headers: { "content-type": "application/json", authorization: "Bearer any-rat" },
          body: JSON.stringify({ client_name: "Updated" }),
        });
        expect(res.status).toBe(404);
        const body = (await res.json()) as Record<string, unknown>;
        expect(body["error"]).toBe("invalid_client");
      } finally {
        verifySpy.mockRestore();
        updateSpy.mockRestore();
      }
    });

    it("RFC 6750 §2.1: Bearer scheme is case-insensitive (bearer/BEARER accepted)", async () => {
      const registered = await clientStore.registerClient({
        client_name: "Mixed Case",
        redirect_uris: ["https://claude.ai/callback"],
      });
      const rat = registered.registration_access_token;
      const clientId = registered.client_id;

      for (const scheme of ["bearer", "BEARER", "Bearer", "BeArEr"]) {
        const res = await app.request(`/register/${clientId}`, {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            authorization: `${scheme} ${rat}`,
          },
          body: JSON.stringify({ client_name: `via-${scheme}` }),
        });
        expect(res.status, `scheme=${scheme}`).toBe(200);
      }
    });
  });

  describe("RFC 7592 DELETE /register/{clientId}", () => {
    it("AC2.8: correct RAT removes client and cascades tokens; 204 No Content", async () => {
      // PLAN says (phase_06.md:681): Register a client; issue a token pair for that client via `tokenStore.issueAccessRefreshPair(...)`. Call DELETE `/register/<clientId>` with valid RAT. Assert status=204. Then call `tokenStore.lookupAccessToken(pair.access.plaintext)` — must return null (cascade removed it). Then `clientStore.getClient(clientId)` returns undefined.
      const registered = await clientStore.registerClient({
        client_name: "To Delete",
        redirect_uris: ["https://claude.ai/callback"],
      });

      const rat = registered.registration_access_token;
      const clientId = registered.client_id;

      // Issue a token pair for this client
      const pair = await tokenStore.issueAccessRefreshPair({
        clientId,
        identity: makeVerifiedIdentity({ email: "user@example.com", sub: "user-sub-123" }),
        scope: "openid email",
        resource: "https://mcp.example.com/",
      });

      // Delete the client
      const res = await app.request(`/register/${clientId}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${rat}`,
        },
      });

      expect(res.status).toBe(204);

      // Token should be cascaded/removed
      const token = await tokenStore.lookupAccessToken(pair.access.plaintext);
      expect(token).toBeNull();

      // Client should be deleted
      const client = await clientStore.getClient(clientId);
      expect(client).toBeUndefined();
    });

    it("AC2.12: missing/wrong RAT → 401", async () => {
      const res = await app.request("/register/test-client-id", {
        method: "DELETE",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("DCR rate-limit middleware (AC5.1)", () => {
    it("RFC 7592 PUT/DELETE /register/:id do NOT consume the DCR rate-limit bucket", async () => {
      // The middleware is mounted on the `/register` prefix, which Hono also
      // matches against /register/:id. Without the method+path gate inside
      // buildDcrRateLimit, RFC 7592 management calls would burn the 10/hr
      // bucket after a burst of registrations and start returning 429 for
      // legitimate updates and deletes. Drive 10 POSTs first to exhaust the
      // bucket, then assert PUT and DELETE on /register/:id still pass through.
      const testApp = new Hono();
      testApp.use("/register", buildDcrRateLimit({ trustProxy: true }));
      testApp.post("/register", (c) => c.json({ ok: true }, 201));
      testApp.put("/register/:id", (c) => c.json({ ok: true, op: "put" }, 200));
      testApp.delete("/register/:id", (c) => c.body(null, 204));

      const ip = "203.0.113.99";
      for (let i = 0; i < 10; i++) {
        const res = await testApp.request("/register", {
          method: "POST",
          headers: { "x-forwarded-for": ip, "content-type": "application/json" },
          body: JSON.stringify({ client_name: `Client ${i}`, redirect_uris: ["https://x/"] }),
        });
        expect(res.status).toBe(201);
      }

      // PUT /register/:id from the SAME ip must succeed — bucket only covers POST /register.
      const putRes = await testApp.request("/register/some-client-id", {
        method: "PUT",
        headers: { "x-forwarded-for": ip, "content-type": "application/json" },
        body: JSON.stringify({ client_name: "updated" }),
      });
      expect(putRes.status).toBe(200);

      // DELETE /register/:id from the SAME ip must succeed too.
      const delRes = await testApp.request("/register/some-client-id", {
        method: "DELETE",
        headers: { "x-forwarded-for": ip },
      });
      expect(delRes.status).toBe(204);

      // Sanity: an 11th POST from this ip still hits the limit.
      const blocked = await testApp.request("/register", {
        method: "POST",
        headers: { "x-forwarded-for": ip, "content-type": "application/json" },
        body: JSON.stringify({ client_name: "extra", redirect_uris: ["https://x/"] }),
      });
      expect(blocked.status).toBe(429);
    });

    it("AC5.1: buildDcrRateLimit middleware enforces 10 req/hour limit", async () => {
      // PLAN says (phase_06.md:702-718): The `buildDcrRateLimit()` middleware limits POST /register to 10 requests per hour per IP.
      // Test: 10 requests from same IP succeed (201), 11th is rejected (429).
      const testApp = new Hono();
      testApp.use("/register", buildDcrRateLimit({ trustProxy: true }));
      testApp.post("/register", (c) => c.json({ ok: true }, 201));

      const ip = "203.0.113.7";

      // First 10 requests should succeed
      for (let i = 0; i < 10; i++) {
        const res = await testApp.request("/register", {
          method: "POST",
          headers: {
            "x-forwarded-for": ip,
            "content-type": "application/json",
          },
          body: JSON.stringify({ client_name: `Client ${i}`, redirect_uris: ["https://x/"] }),
        });
        expect(res.status).toBe(201);
      }

      // 11th request should be rate-limited
      const res11 = await testApp.request("/register", {
        method: "POST",
        headers: {
          "x-forwarded-for": ip,
          "content-type": "application/json",
        },
        body: JSON.stringify({ client_name: "Client 11", redirect_uris: ["https://x/"] }),
      });
      expect(res11.status).toBe(429);
    });

    it("different IPs have separate rate-limit windows", async () => {
      // PLAN says (phase_06.md:719): After 10 requests from one IP, a request from a different IP should not be rate-limited.
      const testApp = new Hono();
      testApp.use("/register", buildDcrRateLimit({ trustProxy: true }));
      testApp.post("/register", (c) => c.json({ ok: true }, 201));

      const ip1 = "203.0.113.7";
      const ip2 = "203.0.113.8";

      // Fill up the window for ip1
      for (let i = 0; i < 10; i++) {
        const res = await testApp.request("/register", {
          method: "POST",
          headers: {
            "x-forwarded-for": ip1,
            "content-type": "application/json",
          },
          body: JSON.stringify({ client_name: `Client ${i}`, redirect_uris: ["https://x/"] }),
        });
        expect(res.status).toBe(201);
      }

      // ip2 should still be able to make a request (has its own window)
      const resIp2 = await testApp.request("/register", {
        method: "POST",
        headers: {
          "x-forwarded-for": ip2,
          "content-type": "application/json",
        },
        body: JSON.stringify({ client_name: "Client IP2", redirect_uris: ["https://x/"] }),
      });
      expect(resIp2.status).toBe(201);
    });

    it("trustProxy=false ignores x-forwarded-for (every request collapses to one bucket)", async () => {
      // The default is `trustProxy: false`. With that, the rate-limiter must NOT
      // honor an attacker-controlled `x-forwarded-for`; otherwise a client could
      // vary the header per request and trivially bypass the 10/hr limit. Under
      // Hono's `app.request()` no socket address is available either, so all
      // requests fall back to the "unknown" bucket and share the 10-request budget.
      const testApp = new Hono();
      testApp.use("/register", buildDcrRateLimit({ trustProxy: false }));
      testApp.post("/register", (c) => c.json({ ok: true }, 201));

      // First 10 requests succeed, even though each carries a different XFF.
      for (let i = 0; i < 10; i++) {
        const res = await testApp.request("/register", {
          method: "POST",
          headers: {
            "x-forwarded-for": `203.0.113.${(i + 1).toString()}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ client_name: `Client ${i}`, redirect_uris: ["https://x/"] }),
        });
        expect(res.status).toBe(201);
      }

      // 11th request — different XFF, but still rate-limited because XFF is ignored.
      const blocked = await testApp.request("/register", {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.99",
          "content-type": "application/json",
        },
        body: JSON.stringify({ client_name: "spoofed", redirect_uris: ["https://x/"] }),
      });
      expect(blocked.status).toBe(429);
    });
  });

  describe("DCR client cap middleware (AC5.2)", () => {
    it("AC5.2: buildClientCap middleware enforces client count limit", async () => {
      // PLAN says (phase_06.md:723): The `buildClientCap(cache, max)` middleware prevents DCR registration
      // when the server has reached the max registered clients.
      // Test: Pre-populate cache with 50 clients, then 51st POST /register returns 429 with cap error_description.
      const testCache = new DiskCache(`/tmp/test-cap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await testCache.init();

      const testClientStore = new DiskClientRegistrationStore(
        testCache,
        "https://mcp.example.com",
        pino({ level: "silent" }),
      );
      const testApp = new Hono();
      testApp.use("/register", buildClientCap(testCache, 50));
      testApp.post("/register", (c) => c.json({ ok: true }, 201));

      // Pre-populate cache with 50 clients
      for (let i = 0; i < 50; i++) {
        await testClientStore.registerClient({
          client_name: `Preload Client ${i}`,
          redirect_uris: ["https://x/"],
        });
      }

      // 51st request should be rejected with 429 and cap error
      const res51 = await testApp.request("/register", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ client_name: "Client 51", redirect_uris: ["https://x/"] }),
      });
      expect(res51.status).toBe(429);
      const json = (await res51.json()) as Record<string, unknown>;
      expect(json["error_description"]).toContain("cap");
    });
  });

  describe("pickTokenAuthMethod (RFC 8414 token_endpoint_auth_methods_supported)", () => {
    it("returns 'basic' when discovery field is undefined (RFC 6749 §2.3.1)", () => {
      // RFC 8414 makes token_endpoint_auth_methods_supported optional, and
      // RFC 6749 §2.3.1 specifies that every compliant authorization server
      // MUST accept HTTP Basic at the token endpoint. Defaulting to Basic
      // when discovery is silent is the spec-mandated behavior; defaulting
      // to post would silently fail against Basic-only IdPs whose discovery
      // omits the field.
      expect(pickTokenAuthMethod(undefined)).toBe("basic");
    });

    it("returns 'post' when discovery advertises both methods", () => {
      // post is the long-standing default — when both are offered, keep it.
      expect(pickTokenAuthMethod(["client_secret_basic", "client_secret_post"])).toBe("post");
    });

    it("returns 'basic' when discovery advertises only client_secret_basic", () => {
      // The codex finding case: IdPs that require Basic. Our previous default
      // always sent the secret in the body, which those IdPs reject as
      // `invalid_client`.
      expect(pickTokenAuthMethod(["client_secret_basic"])).toBe("basic");
    });

    it("returns 'post' when discovery advertises only client_secret_post", () => {
      expect(pickTokenAuthMethod(["client_secret_post"])).toBe("post");
    });

    it("returns 'basic' as best-effort when discovery advertises only unsupported methods", () => {
      // private_key_jwt, tls_client_auth, etc. We don't support those — the
      // request will likely fail server-side, but trying the spec-mandated
      // Basic is better than attempting a method neither side promised. An
      // empty list is treated as "field absent" and also falls through to
      // Basic per RFC 6749 §2.3.1.
      expect(pickTokenAuthMethod(["private_key_jwt", "tls_client_auth"])).toBe("basic");
      expect(pickTokenAuthMethod([])).toBe("basic");
    });
  });
});
