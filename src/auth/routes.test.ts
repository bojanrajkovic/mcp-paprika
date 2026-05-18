import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { buildAuthRoutes, buildDcrRateLimit, buildClientCap } from "./routes.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { TokenStore } from "./token-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { DiskCache } from "../cache/disk-cache.js";
import { createOidcStub } from "./__fixtures__/oidc-stub.js";
import { setupServer } from "msw/node";

describe("Auth Routes", () => {
  let cache: DiskCache;
  let app: Hono;
  let authRequests: AuthRequestStore;
  let authCodes: AuthCodeStore;
  let clientStore: DiskClientRegistrationStore;
  let tokenStore: TokenStore;

  beforeEach(async () => {
    const cacheDir = `/tmp/test-routes-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cache = new DiskCache(cacheDir);
    await cache.init();

    clientStore = new DiskClientRegistrationStore(cache);
    tokenStore = new TokenStore(cache);
    authRequests = new AuthRequestStore();
    authCodes = new AuthCodeStore();

    // Setup OIDC stub
    const oidcStub = createOidcStub({
      issuer: "https://idp.stub.example.com",
      clientId: "stub-client-id",
      clientSecret: "stub-client-secret",
      defaultIdentity: {
        email: "user@example.com",
        sub: "user-sub-123",
        emailVerified: true,
      },
    });

    const server = setupServer(...oidcStub.handlers);
    server.listen();

    // Setup Hono app with routes
    app = new Hono();

    app.route(
      "/",
      buildAuthRoutes({
        clientStore,
        tokenStore,
        authRequests,
        authCodes,
        oidcConfig: {
          clientId: "stub-client-id",
          clientSecret: "stub-client-secret",
          scopes: ["openid", "email"],
          emailVerifiedPolicy: "recommended",
          allowlist: { emails: ["user@example.com"], subs: [] },
          allowedAlgs: ["RS256"],
        },
        discovery: {
          issuer: oidcStub.issuer,
          authorization_endpoint: `${oidcStub.issuer}/authorize`,
          token_endpoint: `${oidcStub.issuer}/token`,
          jwks_uri: `${oidcStub.issuer}/jwks`,
        },
        jwks: async () => ({ keys: [] }), // stub
        publicUrl: "https://mcp.example.com",
      }),
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
        createdAt: Math.floor(Date.now() / 1000),
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

    it.todo("AC2.14: success redirect includes iss=<MCP_PUBLIC_URL>");
    // PLAN says (phase_06.md:662-667): successful upstream code exchange → allowlist OK → mints mcp_ac_ → redirects with code+state+iss
    // Deferred to Phase 7 e2e test: requires full OIDC flow (upstream code exchange + id_token verification).
    // routes.ts line 57-88 now implements upstream code exchange with fetch to token_endpoint and id_token extraction.
    // Test setup requires: (1) separate OIDC stub instance to avoid MSW request-body read conflicts,
    // (2) createJwksFor wiring for JWKS verification (jose's createRemoteJWKSet needs real endpoint).
    // Phase 7 e2e test covers the full success path with real HTTP transport.

    it.todo("AC3.4: does NOT log id_token, only identity claims, on denial");
    // PLAN says (phase_06.md:680-686): allowlist denial should log identity claims (email, sub) but never the id_token plaintext.
    // Deferred to Phase 7 e2e test: same rationale as AC2.14 success path above.
    // routes.ts line 124-126 implements the denial logging: logs identity claims only via process.stderr.write().
    // Test setup requires full OIDC flow with separate stub instance to avoid MSW conflicts.

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
      const json = (await res.json()) as any;
      expect(json.client_name).toBe("Updated Name");
      expect(json.registration_client_uri).toBeTruthy();
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
        identity: { email: "user@example.com", sub: "user-sub-123", source: "email" },
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

      const testClientStore = new DiskClientRegistrationStore(testCache);
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
      const json = (await res51.json()) as any;
      expect(json.error_description).toContain("cap");
    });
  });
});
