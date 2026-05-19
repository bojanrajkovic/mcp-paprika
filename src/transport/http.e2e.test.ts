/**
 * End-to-end test for the full claude.ai connector OAuth 2.1 flow.
 *
 * Stands up the HTTP server in-process with MSW intercepting the upstream
 * OIDC provider (Google-shaped). Drives the full flow — DCR → authorize →
 * upstream callback → token → /mcp — without shortcuts.
 *
 * Verifies:
 *   AC1.1 — DCR returns client_id + registration_access_token
 *   AC1.2 — /token returns mcp_at_ + mcp_rt_ + expires_in=86400
 *   AC1.3 — /mcp with Bearer accepts initialize, returns serverInfo
 *   AC1.4 — refresh-token rotation: new pair returned, old refresh invalid_grant
 *   AC2.14 — iss on both success and error callback redirects
 *   AC3.4 — denied identity → error redirect; no id_token plaintext in stderr
 *   AC4.4 — auth codes do NOT survive server restart
 */

import { randomBytes, createHash } from "node:crypto";

import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startHttp, type HttpTransportHandle } from "./http.js";
import type { PaprikaConfig } from "../utils/config.js";
import { createOidcStub } from "../auth/__fixtures__/oidc-stub.js";
import { useXdgIsolation } from "../__fixtures__/xdg-isolation.js";
import { useMswServer } from "../__fixtures__/msw.js";

// ============================================================================
// Constants
// ============================================================================

const OIDC_ISSUER = "https://accounts.google.com";
const PUBLIC_URL = "https://m.example.test";
const ALLOWED_EMAIL = "user@x.com";
const PAPRIKA_AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";
const PAPRIKA_API_BASE = "https://paprikaapp.com/api/v2/sync";

// ============================================================================
// MSW server (process-level, shared across all tests)
// ============================================================================

const msw = useMswServer([], { onUnhandledRequest: "bypass" });

// ============================================================================
// Paprika API mock handlers
// ============================================================================

function paprikaMockHandlers() {
  return [
    http.post(PAPRIKA_AUTH_URL, () => HttpResponse.json({ result: { token: "test-token" } })),
    http.get(`${PAPRIKA_API_BASE}/recipes/`, () => HttpResponse.json({ result: [] })),
    http.get(`${PAPRIKA_API_BASE}/categories/`, () => HttpResponse.json({ result: [] })),
    http.get(`${PAPRIKA_API_BASE}/pantry/`, () => HttpResponse.json({ result: [] })),
  ];
}

// ============================================================================
// Config factory
// ============================================================================

function makeE2eConfig(overrides: Partial<PaprikaConfig> = {}): PaprikaConfig {
  return {
    paprika: { email: "test@example.com", password: "secret" },
    sync: { enabled: false, interval: 60_000 },
    transport: "http",
    http: { port: 0, host: "127.0.0.1" },
    oauth: {
      publicUrl: PUBLIC_URL,
      preset: undefined,
      // Use discoveryUrl directly (safer than relying on preset path expansion)
      discoveryUrl: `${OIDC_ISSUER}/.well-known/openid-configuration`,
      scopes: ["openid", "email"],
      emailVerifiedPolicy: "strict",
      allowedAlgs: ["RS256"],
      clientId: "test-upstream-client",
      clientSecret: "test-upstream-secret",
      allowlist: { emails: [ALLOWED_EMAIL], subs: [] },
    },
    ...overrides,
  } as unknown as PaprikaConfig;
}

// ============================================================================
// DCR helper
// ============================================================================

function makeClaudeAiRegistration(): Record<string, unknown> {
  return {
    client_name: "Claude.ai",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    redirect_uris: ["https://claude.ai/callback"],
    scope: "openid email",
    token_endpoint_auth_method: "none",
  };
}

// ============================================================================
// PKCE helpers
// ============================================================================

function generatePkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

// ============================================================================
// F7: buildAuthorizeUrl — deduplicated authorize URL builder
// ============================================================================

function buildAuthorizeUrl(port: number, clientId: string, codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://claude.ai/callback",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    state,
    scope: "openid email",
    resource: PUBLIC_URL,
  });
  return `http://127.0.0.1:${port.toString()}/authorize?${params.toString()}`;
}

// ============================================================================
// Full-flow helper — drives DCR → authorize → upstream callback → our callback
// Returns { registration, tokens, port }
// ============================================================================

interface FullFlowResult {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  port: number;
}

/**
 * Drive the complete OAuth flow on the given server port using the
 * pre-registered OIDC stub. Returns the issued tokens.
 *
 * Option A: we drive the stub's /authorize endpoint as a real HTTP request
 * so `codeToNonce` is populated naturally by the stub's GET /authorize handler.
 * The stub redirects to our /oauth/callback with a synthesized upstream code.
 * We then follow that to /oauth/callback.
 */
async function driveFullFlow(port: number): Promise<FullFlowResult> {
  // Step 1: DCR — AC1.1
  const registration = (await fetch(`http://127.0.0.1:${port.toString()}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(makeClaudeAiRegistration()),
  }).then((r) => r.json())) as Record<string, unknown>;
  const clientId = registration["client_id"] as string;

  // Step 2: GET /authorize — our server builds upstream URL and redirects
  const { codeVerifier, codeChallenge } = generatePkce();
  const claudeState = `claude-state-${randomBytes(8).toString("hex")}`;
  const authRes = await fetch(buildAuthorizeUrl(port, clientId, codeChallenge, claudeState), { redirect: "manual" });
  // Our server redirects to upstream /authorize
  const upstreamRedirectUrl = authRes.headers.get("location") ?? "";

  // Step 3: Follow redirect to upstream /authorize — MSW intercepts this.
  // The stub's GET /authorize handler populates codeToNonce and redirects
  // to our /oauth/callback with an upstream code. We follow manually so we
  // can intercept the callback redirect rather than letting it go to claude.ai.
  const upstreamAuthRes = await fetch(upstreamRedirectUrl, { redirect: "manual" });
  // The stub redirects to our /oauth/callback?code=...&state=...
  const callbackUrl = upstreamAuthRes.headers.get("location") ?? "";
  // The stub targets /oauth/callback at PUBLIC_URL but we need to hit our
  // real server at 127.0.0.1. Rewrite the host/scheme.
  const callbackParsed = new URL(callbackUrl);
  const localCallbackUrl = new URL(
    `http://127.0.0.1:${port.toString()}/oauth/callback` + `?${callbackParsed.searchParams.toString()}`,
  );

  // Step 4: GET /oauth/callback — exchanges upstream code, verifies id_token,
  // runs allowlist check, mints mcp_ac_ code, redirects to claude.ai.
  const callbackRes = await fetch(localCallbackUrl.toString(), { redirect: "manual" });
  const claudeRedirectUrl = callbackRes.headers.get("location") ?? "";
  const claudeRedirect = new URL(claudeRedirectUrl);
  const ourCode = claudeRedirect.searchParams.get("code") ?? "";

  // Step 5: POST /token — exchange authorization code for tokens
  const tokenRes = await fetch(`http://127.0.0.1:${port.toString()}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: ourCode,
      redirect_uri: "https://claude.ai/callback",
      code_verifier: codeVerifier,
      client_id: clientId,
      resource: PUBLIC_URL,
    }),
  });
  const tokens = (await tokenRes.json()) as Record<string, unknown>;

  return {
    clientId,
    accessToken: tokens["access_token"] as string,
    refreshToken: tokens["refresh_token"] as string,
    port,
  };
}

// ============================================================================
// E2E test suite
// ============================================================================

describe("HTTP e2e: full claude.ai connector flow", () => {
  let handle: HttpTransportHandle;
  let port: number;
  let oidcStub: ReturnType<typeof createOidcStub>;
  const xdg = useXdgIsolation("mcp-paprika-e2e");

  beforeEach(async () => {
    // Redirect getCacheDir() / getConfigDir() to an isolated temp dir
    await xdg.setup();

    // Register MSW handlers before startHttp so discovery + Paprika auth
    // during buildAppContext are intercepted correctly.
    oidcStub = createOidcStub({
      issuer: OIDC_ISSUER,
      clientId: "test-upstream-client",
      clientSecret: "test-upstream-secret",
      defaultIdentity: { email: ALLOWED_EMAIL, sub: "google-user-1", emailVerified: true },
    });
    msw.use(...oidcStub.handlers, ...paprikaMockHandlers());

    handle = await startHttp(makeE2eConfig());
    port = handle.port;
  });

  afterEach(async () => {
    await handle.shutdown();
    await xdg.teardown();
  });

  // --------------------------------------------------------------------------
  // AC1.1 + AC1.2 + AC1.3: Full DCR → authorize → callback → token → /mcp
  // --------------------------------------------------------------------------

  it("AC1.1+1.2+1.3: full DCR → authorize → callback → token → /mcp flow", async () => {
    // Step 1: DCR — AC1.1 (PLAN says phase_07.md:669-678)
    const registrationRes = await fetch(`http://127.0.0.1:${port.toString()}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeClaudeAiRegistration()),
    });
    expect(registrationRes.status).toBe(201);
    const registration = (await registrationRes.json()) as Record<string, unknown>;
    // AC1.1: client_id + registration_access_token are returned, no client_secret
    expect(typeof registration["client_id"]).toBe("string");
    expect((registration["client_id"] as string).length).toBeGreaterThan(0);
    expect(registration["registration_access_token"]).toMatch(/^mcp_rat_/);
    expect(registration).not.toHaveProperty("client_secret");
    const clientId = registration["client_id"] as string;

    // Step 2: GET /authorize — PKCE (PLAN says phase_07.md:680-693)
    const { codeVerifier, codeChallenge } = generatePkce();
    const claudeState = "claude-state-e2e-test";
    const authRes = await fetch(buildAuthorizeUrl(port, clientId, codeChallenge, claudeState), { redirect: "manual" });
    expect(authRes.status).toBe(302);
    const upstreamRedirectUrl = authRes.headers.get("location") ?? "";
    const upstreamParsed = new URL(upstreamRedirectUrl);
    // Our server should redirect to the upstream IdP
    expect(upstreamParsed.origin).toBe(OIDC_ISSUER);

    // Step 3: Follow to upstream /authorize — stub populates codeToNonce
    // (Option A: drive the stub's /authorize naturally)
    const upstreamAuthRes = await fetch(upstreamRedirectUrl, { redirect: "manual" });
    expect(upstreamAuthRes.status).toBe(302);
    const callbackUrlFull = upstreamAuthRes.headers.get("location") ?? "";
    const callbackParsed = new URL(callbackUrlFull);
    // Stub redirects to our /oauth/callback at PUBLIC_URL — rewrite to local
    const localCallbackUrl =
      `http://127.0.0.1:${port.toString()}/oauth/callback` + `?${callbackParsed.searchParams.toString()}`;

    // Step 4: GET /oauth/callback → redirects to claude.ai with code + iss
    const callbackRes = await fetch(localCallbackUrl, { redirect: "manual" });
    expect(callbackRes.status).toBe(302);
    const claudeRedirectUrl = callbackRes.headers.get("location") ?? "";
    const claudeRedirect = new URL(claudeRedirectUrl);
    expect(claudeRedirect.origin).toBe("https://claude.ai");
    expect(claudeRedirect.searchParams.get("state")).toBe(claudeState);
    // AC2.14: iss on success redirect (PLAN says phase_07.md:709)
    expect(claudeRedirect.searchParams.get("iss")).toBe(PUBLIC_URL);
    const ourCode = claudeRedirect.searchParams.get("code") ?? "";
    expect(ourCode).toMatch(/^mcp_ac_/);

    // Step 5: POST /token — AC1.2 (PLAN says phase_07.md:714-731)
    const tokenRes = await fetch(`http://127.0.0.1:${port.toString()}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: ourCode,
        redirect_uri: "https://claude.ai/callback",
        code_verifier: codeVerifier,
        client_id: clientId,
        resource: PUBLIC_URL,
      }),
    });
    expect(tokenRes.status).toBe(200);
    const tokens = (await tokenRes.json()) as Record<string, unknown>;
    // AC1.2: access_token (mcp_at_), refresh_token (mcp_rt_), expires_in=86400
    expect(tokens["access_token"]).toMatch(/^mcp_at_/);
    expect(tokens["refresh_token"]).toMatch(/^mcp_rt_/);
    expect(tokens["expires_in"]).toBe(86400);
    expect(tokens["token_type"]).toBe("Bearer");

    // Step 6: POST /mcp initialize with Bearer — AC1.3 (PLAN says phase_07.md:733-743)
    const initBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1" },
      },
    };
    const initRes = await fetch(`http://127.0.0.1:${port.toString()}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${tokens["access_token"] as string}`,
      },
      body: JSON.stringify(initBody),
    });
    expect(initRes.status).toBe(200);
    // AC1.3: session id header present, serverInfo.name = "mcp-paprika"
    expect(initRes.headers.get("mcp-session-id")).toBeTruthy();
    // Parse response — may be SSE or JSON
    const contentType = initRes.headers.get("content-type") ?? "";
    const initText = await initRes.text();
    let initResult: Record<string, unknown>;
    if (contentType.includes("text/event-stream")) {
      const dataLine = initText.split("\n").find((l) => l.startsWith("data:"));
      initResult = JSON.parse((dataLine ?? "data:{}").slice("data:".length).trim()) as Record<string, unknown>;
    } else {
      initResult = JSON.parse(initText) as Record<string, unknown>;
    }
    const serverInfo = (initResult["result"] as Record<string, unknown>)["serverInfo"] as Record<string, unknown>;
    expect(serverInfo["name"]).toBe("mcp-paprika");
  });

  // --------------------------------------------------------------------------
  // AC1.4: Refresh-token rotation
  // --------------------------------------------------------------------------

  it("AC1.4: refresh_token rotates: new pair works, old refresh returns invalid_grant", async () => {
    // PLAN says phase_07.md:747-771
    const { clientId, accessToken, refreshToken } = await driveFullFlow(port);
    // Guard: ensure driveFullFlow actually issued tokens (vacuous-pass prevention)
    expect(accessToken).toMatch(/^mcp_at_/);
    expect(refreshToken).toMatch(/^mcp_rt_/);

    // First refresh — should succeed with new pair
    const refreshRes = await fetch(`http://127.0.0.1:${port.toString()}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
    expect(refreshRes.status).toBe(200);
    const fresh = (await refreshRes.json()) as Record<string, unknown>;
    // New tokens must differ from original tokens
    expect(fresh["access_token"]).not.toBe(accessToken);
    expect(fresh["refresh_token"]).not.toBe(refreshToken);
    expect(fresh["access_token"]).toMatch(/^mcp_at_/);
    expect(fresh["refresh_token"]).toMatch(/^mcp_rt_/);

    // Reuse old refresh token — must return invalid_grant
    const reuseRes = await fetch(`http://127.0.0.1:${port.toString()}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
      }),
    });
    expect(reuseRes.status).toBe(400);
    const reuseBody = (await reuseRes.json()) as Record<string, unknown>;
    expect(reuseBody["error"]).toBe("invalid_grant");
  });

  // --------------------------------------------------------------------------
  // AC3.4: Denied identity flows back as error redirect; no id_token in stderr
  // --------------------------------------------------------------------------

  it("AC3.4: denied identity flows back as error redirect; no token issued; id_token not in stderr", async () => {
    // PLAN says phase_07.md:773-781
    // Spy on stderr to assert the id_token is not leaked as plaintext
    const stderrWrites: string[] = [];
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation((msg: unknown) => {
      stderrWrites.push(typeof msg === "string" ? msg : String(msg));
      return true;
    });

    try {
      // Override identity to a denied email BEFORE triggering the authorize flow
      oidcStub.authenticateNext({ email: "intruder@y.com", sub: "intruder-sub-1", emailVerified: true });

      // Register a client (need a fresh client_id for this isolated test)
      const registrationRes = await fetch(`http://127.0.0.1:${port.toString()}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(makeClaudeAiRegistration()),
      });
      const registration = (await registrationRes.json()) as Record<string, unknown>;
      const clientId = registration["client_id"] as string;

      // GET /authorize → upstream redirect
      const { codeChallenge } = generatePkce();
      const claudeState = "claude-state-ac34";
      const authRes = await fetch(buildAuthorizeUrl(port, clientId, codeChallenge, claudeState), {
        redirect: "manual",
      });
      const upstreamRedirectUrl = authRes.headers.get("location") ?? "";

      // Follow to upstream /authorize — stub returns the intruder identity
      const upstreamAuthRes = await fetch(upstreamRedirectUrl, { redirect: "manual" });
      const callbackUrlFull = upstreamAuthRes.headers.get("location") ?? "";
      const callbackParsed = new URL(callbackUrlFull);
      const localCallbackUrl =
        `http://127.0.0.1:${port.toString()}/oauth/callback` + `?${callbackParsed.searchParams.toString()}`;

      // GET /oauth/callback — allowlist should deny intruder@y.com
      const callbackRes = await fetch(localCallbackUrl, { redirect: "manual" });
      expect(callbackRes.status).toBe(302);
      const loc = new URL(callbackRes.headers.get("location") ?? "");
      // AC3.4: error=access_denied in the redirect
      expect(loc.searchParams.get("error")).toBe("access_denied");
      // AC2.14: iss on error redirect (PLAN says phase_07.md:780)
      expect(loc.searchParams.get("iss")).toBe(PUBLIC_URL);

      // AC3.4: stderr must not contain id_token plaintext (no JWT eyJ... header)
      // JWTs always start with base64url("{"alg":...}) = eyJ
      const stderrOutput = stderrWrites.join("");
      expect(stderrOutput).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    } finally {
      stderrSpy.mockRestore();
    }
  });

  // --------------------------------------------------------------------------
  // AC4.4: Auth codes do not survive server restart
  // --------------------------------------------------------------------------

  it("AC4.4: auth codes are in-memory and do not survive server restart", async () => {
    // PLAN says phase_07.md:784-787
    // Drive the flow up to step 4 — obtain an mcp_ac_ code but do NOT exchange it.
    const registrationRes = await fetch(`http://127.0.0.1:${port.toString()}/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(makeClaudeAiRegistration()),
    });
    const registration = (await registrationRes.json()) as Record<string, unknown>;
    const clientId = registration["client_id"] as string;

    const { codeVerifier, codeChallenge } = generatePkce();
    const claudeState = "claude-state-ac44";
    const authRes = await fetch(buildAuthorizeUrl(port, clientId, codeChallenge, claudeState), { redirect: "manual" });
    const upstreamRedirectUrl = authRes.headers.get("location") ?? "";
    const upstreamAuthRes = await fetch(upstreamRedirectUrl, { redirect: "manual" });
    const callbackUrlFull = upstreamAuthRes.headers.get("location") ?? "";
    const callbackParsed = new URL(callbackUrlFull);
    const localCallbackUrl =
      `http://127.0.0.1:${port.toString()}/oauth/callback` + `?${callbackParsed.searchParams.toString()}`;
    const callbackRes = await fetch(localCallbackUrl, { redirect: "manual" });
    const claudeRedirectUrl = callbackRes.headers.get("location") ?? "";
    const claudeRedirect = new URL(claudeRedirectUrl);
    const ourCode = claudeRedirect.searchParams.get("code") ?? "";
    expect(ourCode).toMatch(/^mcp_ac_/);

    // Shutdown the server — code is now orphaned in-memory
    await handle.shutdown();

    // Restart with the SAME cache dir (XDG env vars still set, same disk state)
    // Re-register MSW handlers since they were reset in afterEach on a different order.
    // Note: we are still inside the test so afterEach has NOT run yet.
    // MSW handlers are still from beforeEach (not reset within a test).
    handle = await startHttp(makeE2eConfig());
    const newPort = handle.port;

    // Try to exchange the old mcp_ac_ code on the new server instance.
    // AuthCodeStore is in-memory only — it does not persist to disk.
    const tokenRes = await fetch(`http://127.0.0.1:${newPort.toString()}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: ourCode,
        redirect_uri: "https://claude.ai/callback",
        code_verifier: codeVerifier,
        client_id: clientId,
        resource: PUBLIC_URL,
      }),
    });
    expect(tokenRes.status).toBe(400);
    const tokenBody = (await tokenRes.json()) as Record<string, unknown>;
    expect(tokenBody["error"]).toBe("invalid_grant");
  });
});
