import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fromAny } from "@total-typescript/shoehorn";
import { Hono } from "hono";
import type { JWTVerifyGetKey } from "jose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { makeVerifiedIdentity } from "../../test/auth/__fixtures__/oauth-state.js";
import { makeDefaultOidcStub, makeDiscoveryDoc } from "../../test/auth/__fixtures__/oidc-stub.js";
import { useTempDir } from "../../test/support/disk-caches.js";
import { useMswServer } from "../../test/support/msw.js";
import { makePinoCapture } from "../../test/support/tool-test-utils.js";
import { SILENT_LOG } from "../utils/log.js";
import { AuthCodeStore } from "./auth-code-store.js";
import { AuthRequestStore } from "./auth-request-store.js";
import { DiskClientRegistrationStore } from "./client-registration.js";
import { type AuthCache, buildAuthCaches } from "./disk.js";
import { OAuthClientNotFoundError } from "./errors.js";
import { createJwksFor } from "./oidc-client.js";
import { PendingAuthorizationStore } from "./pending-authorization-store.js";
import {
  type AuthRoutesDeps,
  buildAuthRoutes,
  buildClientCap,
  buildDcrRateLimit,
  pickTokenAuthMethod,
} from "./routes.js";
import { TokenStore } from "./token-store.js";
import { nowSeconds } from "./tokens.js";

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
  pendingAuthorizations: PendingAuthorizationStore;
  oidcStubIssuer: string;
};

type RoutesOverrides = {
  jwks?: JWTVerifyGetKey;
  authRequests?: AuthRequestStore;
  authCodes?: AuthCodeStore;
  pendingAuthorizations?: PendingAuthorizationStore;
};

function makeRoutesConfig(ctx: RoutesCtx, overrides: RoutesOverrides = {}): AuthRoutesDeps {
  return {
    clientStore: ctx.clientStore,
    tokenStore: ctx.tokenStore,
    authRequests: overrides.authRequests ?? ctx.authRequests,
    authCodes: overrides.authCodes ?? ctx.authCodes,
    pendingAuthorizations: overrides.pendingAuthorizations ?? ctx.pendingAuthorizations,
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
      redirectAllowlist: [],
    },
    discovery: makeDiscoveryDoc(ctx.oidcStubIssuer),
    jwks: overrides.jwks ?? fromAny(async () => ({ keys: [] })),
    publicUrl: "https://mcp.example.com",
    log: { auth: SILENT_LOG, oidcClient: SILENT_LOG },
  };
}

// Created at module scope so handlers can be passed as permanent initial handlers
// to useMswServer (permanent = not removed by resetHandlers).
const oidcStub = makeDefaultOidcStub();

describe("Auth Routes", () => {
  const tmp = useTempDir("paprika-routes-");
  let cache: AuthCache;
  let app: Hono;
  let authRequests: AuthRequestStore;
  let authCodes: AuthCodeStore;
  let pendingAuthorizations: PendingAuthorizationStore;
  let clientStore: DiskClientRegistrationStore;
  let tokenStore: TokenStore;

  // useMswServer wires beforeAll(listen) + afterEach(resetHandlers + onReset) + afterAll(close).
  // oidcStub.handlers are passed as permanent handlers so resetHandlers() preserves them.
  const msw = useMswServer([...oidcStub.handlers], { onReset: () => oidcStub.resetOverrides() });

  beforeEach(async () => {
    await tmp.setup();
    cache = (await buildAuthCaches(tmp.dir()))._unsafeUnwrap();

    clientStore = new DiskClientRegistrationStore(cache, "https://mcp.example.com", SILENT_LOG);
    tokenStore = new TokenStore(cache);
    authRequests = new AuthRequestStore();
    authCodes = new AuthCodeStore();
    pendingAuthorizations = new PendingAuthorizationStore();

    // Setup Hono app with routes
    app = new Hono();

    app.route(
      "/",
      buildAuthRoutes(
        makeRoutesConfig({
          clientStore,
          tokenStore,
          authRequests,
          authCodes,
          pendingAuthorizations,
          oidcStubIssuer: oidcStub.issuer,
        }),
      ),
    );
  });

  afterEach(async () => {
    await tmp.teardown();
  });

  describe("GET /oauth/callback", () => {
    it("error redirect includes iss on upstream error", async () => {
      // app.request("/oauth/callback?error=access_denied&state=<ourState>"). Status=302, `iss` in location query, `error=access_denied`.
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

    it("success redirect includes iss=<MCP_PUBLIC_URL>", async () => {
      // successful upstream code exchange → allowlist OK → mints mcp_ac_ → redirects with code+state+iss
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
            {
              clientStore,
              tokenStore,
              authRequests,
              authCodes,
              pendingAuthorizations,
              oidcStubIssuer: oidcStub.issuer,
            },
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

    it("redirects with temporarily_unavailable (not a code) when the auth-code store is full", async () => {
      const realJwks = createJwksFor(makeDiscoveryDoc(oidcStub.issuer));

      const localAuthRequests = new AuthRequestStore();
      const fullAuthCodes = new AuthCodeStore({ maxEntries: 0 }); // every put is rejected
      const localApp = new Hono();
      localApp.route(
        "/",
        buildAuthRoutes(
          makeRoutesConfig(
            {
              clientStore,
              tokenStore,
              authRequests,
              authCodes,
              pendingAuthorizations,
              oidcStubIssuer: oidcStub.issuer,
            },
            { jwks: realJwks, authRequests: localAuthRequests, authCodes: fullAuthCodes },
          ),
        ),
      );

      const ourState = "mcp_state_fullcode_test";
      const ourNonce = "mcp_nonce_fullcode_test";
      localAuthRequests.put(ourState, {
        clientId: "stub-client-id",
        codeChallenge: "challenge",
        codeChallengeMethod: "S256",
        redirectUri: "https://claude.ai/callback",
        resource: "https://mcp.example.com/",
        claudeState: "claude_state_fullcode",
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
      const loc = new URL(res.headers.get("location")!);
      expect(loc.origin + loc.pathname).toBe("https://claude.ai/callback");
      expect(loc.searchParams.get("error")).toBe("temporarily_unavailable");
      expect(loc.searchParams.get("code")).toBeNull();
      expect(loc.searchParams.get("state")).toBe("claude_state_fullcode");
      expect(loc.searchParams.get("iss")).toBe("https://mcp.example.com");
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
            {
              clientStore,
              tokenStore,
              authRequests,
              authCodes,
              pendingAuthorizations,
              oidcStubIssuer: oidcStub.issuer,
            },
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

    it("does NOT log id_token, only identity claims, on denial", async () => {
      // allowlist denial logs identity claims (email, sub) but never id_token.
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
            {
              clientStore,
              tokenStore,
              authRequests,
              authCodes,
              pendingAuthorizations,
              oidcStubIssuer: oidcStub.issuer,
            },
            { jwks: realJwks, authRequests: localAuthRequests, authCodes: localAuthCodes },
          ),
          log: { auth: authLog, oidcClient: SILENT_LOG },
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

      // id_token must NOT appear in captured log records (JWTs start with "eyJ")
      expect(JSON.stringify(records)).not.toMatch(/eyJ/);

      // identity claims MUST appear in the denial log record as structured fields,
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

    it("emits info record on allowlist hit", async () => {
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
            {
              clientStore,
              tokenStore,
              authRequests,
              authCodes,
              pendingAuthorizations,
              oidcStubIssuer: oidcStub.issuer,
            },
            { jwks: realJwks, authRequests: localAuthRequests, authCodes: localAuthCodes },
          ),
          log: { auth: authLog, oidcClient: SILENT_LOG },
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

      // info record must be emitted for the accepted identity, and must carry
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
    it("correct RAT updates metadata; 200 with full doc + registration_client_uri", async () => {
      // Register a client via `clientStore.registerClient(...)` to get the RAT (registration_access_token). Call PUT `/register/<clientId>` with `Authorization: Bearer <RAT>` header and a JSON body containing updated metadata (`client_name`). Assert status=200, JSON body has new client_name + registration_client_uri.
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

    it("missing Authorization → 401", async () => {
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
    it("correct RAT removes client and cascades tokens; 204 No Content", async () => {
      // Register a client; issue a token pair for that client via `tokenStore.issueAccessRefreshPair(...)`. Call DELETE `/register/<clientId>` with valid RAT. Assert status=204. Then call `tokenStore.lookupAccessToken(pair.access.plaintext)` — must return null (cascade removed it). Then `clientStore.getClient(clientId)` returns undefined.
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

    it("missing/wrong RAT → 401", async () => {
      const res = await app.request("/register/test-client-id", {
        method: "DELETE",
      });
      expect(res.status).toBe(401);
    });
  });

  describe("DCR rate-limit middleware", () => {
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

    it("buildDcrRateLimit middleware enforces 10 req/hour limit", async () => {
      // The `buildDcrRateLimit()` middleware limits POST /register to 10 requests per hour per IP.
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
      // After 10 requests from one IP, a request from a different IP should not be rate-limited.
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

  describe("DCR client cap middleware", () => {
    it("buildClientCap middleware enforces client count limit", async () => {
      // The `buildClientCap(cache, max)` middleware prevents DCR registration
      // when the server has reached the max registered clients.
      // Test: Pre-populate cache with 50 clients, then 51st POST /register returns 429 with cap error_description.
      const capDir = await mkdtemp(join(tmpdir(), "paprika-cap-"));
      const testCache = (await buildAuthCaches(capDir))._unsafeUnwrap();

      const testClientStore = new DiskClientRegistrationStore(testCache, "https://mcp.example.com", SILENT_LOG);
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
      await rm(capDir, { recursive: true, force: true });
    });
  });

  describe("POST /oauth/consent (#147)", () => {
    function seedPending(ticket: string, overrides: Record<string, unknown> = {}): void {
      pendingAuthorizations.put(ticket, {
        clientId: "123e4567-e89b-12d3-a456-426614174000",
        codeChallenge: "challenge-123",
        codeChallengeMethod: "S256",
        redirectUri: "https://paprika-sync.app/cb",
        resource: "https://mcp.example.com/",
        claudeState: "claude-state",
        scope: "openid email",
        clientName: "Sneaky",
        createdAt: nowSeconds(),
        ...overrides,
      });
    }

    async function postConsent(app: Hono, ticket: string, decision: string): Promise<Response> {
      return app.request("/oauth/consent", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ ticket, decision }).toString(),
      });
    }

    it("allow → 302 to the upstream authorize endpoint and mints AuthRequestState", async () => {
      seedPending("mcp_consent_allow");

      const res = await postConsent(app, "mcp_consent_allow", "allow");

      expect(res.status).toBe(302);
      const location = new URL(res.headers.get("location")!);
      expect(location.origin + location.pathname).toBe("https://idp.stub.example.com/authorize");
      const ourState = location.searchParams.get("state")!;
      const stored = authRequests.consume(ourState);
      expect(stored?.redirectUri).toBe("https://paprika-sync.app/cb");
      expect(stored?.claudeState).toBe("claude-state");
      // ticket is single-use
      expect(pendingAuthorizations.size).toBe(0);
    });

    it("deny → 200 terminal page, no redirect, no AuthRequestState minted", async () => {
      seedPending("mcp_consent_deny");

      const res = await postConsent(app, "mcp_consent_deny", "deny");

      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      const body = await res.text();
      expect(body.toLowerCase()).toContain("denied");
      expect(body).not.toContain("/oauth/callback");
      expect(pendingAuthorizations.size).toBe(0);
    });

    it("unknown/expired ticket → 400 expired page", async () => {
      const res = await postConsent(app, "mcp_consent_nope", "allow");

      expect(res.status).toBe(400);
      expect(res.headers.get("X-Frame-Options")).toBe("DENY");
      expect((await res.text()).toLowerCase()).toContain("expired");
    });

    it("a ticket is single-use — replaying it yields the expired page", async () => {
      seedPending("mcp_consent_replay");

      const first = await postConsent(app, "mcp_consent_replay", "allow");
      expect(first.status).toBe(302);

      const second = await postConsent(app, "mcp_consent_replay", "allow");
      expect(second.status).toBe(400);
    });

    it("logs consent granted at info and consent denied at warn (audit), with no raw ticket", async () => {
      const { log: captureLog, records } = makePinoCapture();
      const deps = {
        ...makeRoutesConfig({
          clientStore,
          tokenStore,
          authRequests,
          authCodes,
          pendingAuthorizations,
          oidcStubIssuer: oidcStub.issuer,
        }),
        log: { auth: captureLog, oidcClient: SILENT_LOG },
      };
      const localApp = new Hono();
      localApp.route("/", buildAuthRoutes(deps));

      seedPending("mcp_consent_log_allow");
      await postConsent(localApp, "mcp_consent_log_allow", "allow");
      seedPending("mcp_consent_log_deny");
      await postConsent(localApp, "mcp_consent_log_deny", "deny");

      const granted = records.find((r) => r["msg"] === "consent granted");
      const denied = records.find((r) => r["msg"] === "consent denied");
      expect(granted?.["redirectOrigin"]).toBe("https://paprika-sync.app");
      expect(denied?.["level"]).toBe(warnLevel);
      expect(denied?.["redirectOrigin"]).toBe("https://paprika-sync.app");
      // tickets must never be logged
      expect(JSON.stringify(records)).not.toContain("mcp_consent_log_");
    });

    it("logs the actual submitted decision (not a hardcoded 'deny') for a non-allow value", async () => {
      const { log: captureLog, records } = makePinoCapture();
      const deps = {
        ...makeRoutesConfig({
          clientStore,
          tokenStore,
          authRequests,
          authCodes,
          pendingAuthorizations,
          oidcStubIssuer: oidcStub.issuer,
        }),
        log: { auth: captureLog, oidcClient: SILENT_LOG },
      };
      const localApp = new Hono();
      localApp.route("/", buildAuthRoutes(deps));

      seedPending("mcp_consent_cancel");
      const res = await postConsent(localApp, "mcp_consent_cancel", "cancel");

      expect(res.status).toBe(200); // any non-allow value denies
      const denied = records.find((r) => r["msg"] === "consent denied");
      expect(denied?.["decision"]).toBe("cancel");
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
