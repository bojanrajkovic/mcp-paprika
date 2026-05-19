import { describe, it, expect, beforeEach, vi } from "vitest";
import { nowSeconds } from "./tokens.js";
import { Hono } from "hono";
import { buildAuthRoutes, buildDcrRateLimit, buildClientCap, type AuthRoutesDeps } from "./routes.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { TokenStore } from "./token-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { DiskCache } from "../cache/disk-cache.js";
import { makeDefaultOidcStub, makeDiscoveryDoc } from "./__fixtures__/oidc-stub.js";
import { makeVerifiedIdentity } from "./__fixtures__/oauth-state.js";
import { createJwksFor } from "./oidc-client.js";
import type { JWTVerifyGetKey } from "jose";
import { useMswServer } from "../__fixtures__/msw.js";

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
      allowlist: { emails: ["user@example.com"], subs: [] },
      allowedAlgs: ["RS256"],
    },
    discovery: makeDiscoveryDoc(ctx.oidcStubIssuer),
    jwks: overrides.jwks ?? ((async () => ({ keys: [] })) as unknown as JWTVerifyGetKey),
    publicUrl: "https://mcp.example.com",
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
  useMswServer([...oidcStub.handlers], { onReset: () => oidcStub.resetOverrides() });

  beforeEach(async () => {
    const cacheDir = `/tmp/test-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cache = new DiskCache(cacheDir);
    await cache.init();

    clientStore = new DiskClientRegistrationStore(cache, "https://mcp.example.com");
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

    it("AC3.4: does NOT log id_token, only identity claims, on denial", async () => {
      // PLAN says (phase_06.md:680-686): allowlist denial logs identity claims (email, sub) but never id_token.
      // Build a local app with realJwks so verifyIdToken passes, then hit allowlist denial.
      // Only user@example.com is on the allowlist — unknown@example.com will be denied.
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

      // Spy on stderr to capture allowlist denial log output
      const stderrWrites: Array<string> = [];
      const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
        stderrWrites.push(String(chunk));
        return true;
      });

      try {
        // Drive the callback route
        const res = await localApp.request(`/oauth/callback?code=${upstreamCode}&state=${ourState}`);

        // Should redirect with error=access_denied and iss
        expect(res.status).toBe(302);
        const location = res.headers.get("location");
        expect(location).toBeTruthy();
        const loc = new URL(location!);
        expect(loc.searchParams.get("error")).toBe("access_denied");
        expect(loc.searchParams.get("iss")).toBe("https://mcp.example.com");

        // Combine all stderr output
        const allStderr = stderrWrites.join("");

        // AC3.4: id_token must NOT appear in logs (JWTs always start with "eyJ")
        expect(allStderr).not.toMatch(/eyJ/);

        // AC3.4: identity claims MUST appear in the denial log
        expect(allStderr).toMatch(/email=/);
        expect(allStderr).toMatch(/sub=/);
        expect(allStderr).toMatch(/allowlist denial/);
      } finally {
        stderrSpy.mockRestore();
      }
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
    it("AC5.1: buildDcrRateLimit middleware enforces 10 req/hour limit", async () => {
      // PLAN says (phase_06.md:702-718): The `buildDcrRateLimit()` middleware limits POST /register to 10 requests per hour per IP.
      // Test: 10 requests from same IP succeed (201), 11th is rejected (429).
      const testApp = new Hono();
      testApp.use("/register", buildDcrRateLimit());
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
      testApp.use("/register", buildDcrRateLimit());
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
  });

  describe("DCR client cap middleware (AC5.2)", () => {
    it("AC5.2: buildClientCap middleware enforces client count limit", async () => {
      // PLAN says (phase_06.md:723): The `buildClientCap(cache, max)` middleware prevents DCR registration
      // when the server has reached the max registered clients.
      // Test: Pre-populate cache with 50 clients, then 51st POST /register returns 429 with cap error_description.
      const testCache = new DiskCache(`/tmp/test-cap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await testCache.init();

      const testClientStore = new DiskClientRegistrationStore(testCache, "https://mcp.example.com");
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
});
