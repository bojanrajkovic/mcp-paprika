import { join } from "node:path";

import { fromAny } from "@total-typescript/shoehorn";
import { http, HttpResponse } from "msw";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Hono } from "hono";
import { startHttp, accessLog, type HttpTransportHandle, type StartHttpOptions } from "./http.js";
import type { PaprikaConfig } from "../utils/config.js";
import { createOidcStub } from "../auth/__fixtures__/oidc-stub.js";
import { DiskCacheRoot } from "../cache/disk/index.js";
import { makeOAuthClient } from "../cache/__fixtures__/oauth.js";
import { useXdgIsolation } from "../__fixtures__/xdg-isolation.js";
import { useMswServer } from "../__fixtures__/msw.js";
import { failLoudOnUpstream, paprikaSyncMockHandlers, PAPRIKA_API_BASE } from "../__fixtures__/paprika-msw.js";
import { makePinoCapture, SILENT_LOGGING_CONFIG } from "../tools/tool-test-utils.js";

/**
 * These tests drive the HTTP transport with raw `fetch`, not the MCP SDK
 * client. Two reasons: (1) MSW's request interceptor in this test setup
 * already proxies the SDK client's outbound calls in unexpected ways when
 * the target is 127.0.0.1, and (2) raw fetch lets us assert the exact wire
 * shape we care about (status codes, `mcp-session-id` header, SSE framing)
 * without the SDK client layering opinions on top.
 */

// Declare OIDC_ISSUER and PUBLIC_URL here (same as used in OAuth section below)
// so they can be referenced by module-level oidcStub initialization.
const OIDC_ISSUER = "https://accounts.example.test";
const PUBLIC_URL = "https://mcp.example.test";

// Create OIDC stub once at module level so it can be used as permanent handlers
// for both the outer HTTP tests and the nested OAuth describe block.
const oidcStub = createOidcStub({
  issuer: OIDC_ISSUER,
  clientId: "test-upstream-client",
  clientSecret: "test-upstream-secret",
  defaultIdentity: { email: "user@example.com", sub: "google-user-1", emailVerified: true },
});

// Paprika handlers defined as a function so they can be instantiated fresh for
// every initialization of the MSW server (required by setupServer semantics).
function paprikaMockHandlers() {
  // Mock one recipe so coldStartGuard (which checks store.size === 0) doesn't
  // short-circuit category/recipe tools. Most tool handlers require a hydrated
  // recipe store before they'll do anything useful.
  const mockRecipeEntry = { uid: "recipe-1", hash: "h-r1" };
  const mockRecipe = {
    uid: "recipe-1",
    hash: "h-r1",
    name: "Test Recipe",
    categories: [],
    ingredients: "test",
    directions: "test",
    description: null,
    notes: null,
    prep_time: null,
    cook_time: null,
    total_time: null,
    servings: null,
    difficulty: null,
    rating: 0,
    created: "2024-01-01T00:00:00Z",
    image_url: "",
    photo: null,
    photo_hash: null,
    photo_large: null,
    photo_url: null,
    source: null,
    source_url: null,
    on_favorites: false,
    in_trash: false,
    is_pinned: false,
    on_grocery_list: false,
    scale: null,
    nutritional_info: null,
  };
  return [
    // Recipe + category data so coldStartGuard and the recipe/category tools see
    // a hydrated store. These override the empty defaults from
    // paprikaSyncMockHandlers() below — MSW resolves the first matching handler.
    http.get(`${PAPRIKA_API_BASE}/recipes/`, () => HttpResponse.json({ result: [mockRecipeEntry] })),
    http.get(`${PAPRIKA_API_BASE}/recipe/:uid/`, () => HttpResponse.json({ result: mockRecipe })),
    http.get(`${PAPRIKA_API_BASE}/categories/`, () =>
      HttpResponse.json({
        result: [
          { uid: "cat-1", name: "Main Dishes", order_flag: 0, parent_uid: null, hash: "h1" },
          { uid: "cat-2", name: "Desserts", order_flag: 1, parent_uid: null, hash: "h2" },
        ],
      }),
    ),
    http.get(`${PAPRIKA_API_BASE}/category/:uid/`, ({ params }) =>
      HttpResponse.json({
        result: {
          uid: params["uid"],
          name: params["uid"] === "cat-1" ? "Main Dishes" : "Desserts",
          order_flag: params["uid"] === "cat-1" ? 0 : 1,
          parent_uid: null,
        },
      }),
    ),
    // Auth + every sync entity (empty), so the startup sync never escapes to the
    // real paprikaapp.com. See src/__fixtures__/paprika-msw.ts.
    ...paprikaSyncMockHandlers(),
  ];
}

// Initialize MSW server with both Paprika and OIDC stub handlers as permanent handlers.
// This ensures they survive resetHandlers() between tests and are available for the
// nested OAuth describe's beforeAll, which runs before the first test's outer beforeEach.
// Note: msw's lifecycle hooks are wired by the composable; variable is used indirectly.
void useMswServer([...paprikaMockHandlers(), ...oidcStub.handlers], {
  onUnhandledRequest: failLoudOnUpstream,
  onReset: () => oidcStub.resetOverrides(),
});
const xdg = useXdgIsolation("mcp-paprika-http");

function makeConfig(overrides: Partial<PaprikaConfig> = {}): PaprikaConfig {
  // transport: "stdio" — buildAuthContext returns null for stdio, so these tests
  // don't need an oauth block. The transport field doesn't affect how startHttp
  // operates (it's already in HTTP mode by being called at all).
  return {
    paprika: { email: "test@example.com", password: "secret" },
    sync: { enabled: false, interval: 60_000 },
    transport: "stdio",
    http: { port: 0, host: "127.0.0.1", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 0 },
    logging: SILENT_LOGGING_CONFIG,
    ...overrides,
  } as PaprikaConfig;
}

beforeEach(async () => {
  // Note: msw.resetHandlers() is called by the composable's afterEach hook.
  // Paprika handlers are permanent (passed to setupServer), so no need to re-add.
  // OIDC stub handlers are also permanent, but resetOverrides() is called via
  // composable's onReset callback to clear any per-test handler overrides.
  await xdg.setup();
});

afterEach(async () => {
  await xdg.teardown();
});

/** Parse a single SSE `event: message\ndata: {...}` frame and return the parsed JSON. */
function parseSseFrame(text: string): unknown {
  // Pull every `data: …` line, join continuations, parse as JSON.
  const dataLines = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart());
  if (dataLines.length === 0) {
    throw new Error(`No data lines in SSE response: ${text}`);
  }
  return JSON.parse(dataLines.join("\n"));
}

async function postJsonRpc(
  handle: HttpTransportHandle,
  body: Record<string, unknown>,
  sessionId?: string,
): Promise<{ status: number; sessionId: string | null; result: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId !== undefined) {
    headers["mcp-session-id"] = sessionId;
  }
  const response = await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  let result: unknown = null;
  if (text.length > 0) {
    result = contentType.includes("text/event-stream") ? parseSseFrame(text) : JSON.parse(text);
  }
  return {
    status: response.status,
    sessionId: response.headers.get("mcp-session-id"),
    result,
  };
}

async function initializeSession(handle: HttpTransportHandle): Promise<string> {
  const init = await postJsonRpc(handle, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "vitest", version: "0" },
    },
  });
  if (init.status !== 200 || init.sessionId === null) {
    throw new Error(`initialize failed: status=${init.status.toString()} body=${JSON.stringify(init.result)}`);
  }
  // The MCP spec requires the client to send `notifications/initialized`
  // before further requests. Send it as a notification (no id).
  await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-session-id": init.sessionId,
    },
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  return init.sessionId;
}

async function fetchHealth(handle: HttpTransportHandle): Promise<{ ok: boolean; sessions: number }> {
  const r = await fetch(`http://127.0.0.1:${handle.port.toString()}/healthz`);
  return (await r.json()) as { ok: boolean; sessions: number };
}

describe("HTTP transport (Streamable HTTP)", () => {
  describe("HT.1: POST /mcp initialize returns a session id and grows the session map", () => {
    it("creates a new session and reports it in /healthz", async () => {
      const handle = await startHttp(makeConfig());
      try {
        const sessionId = await initializeSession(handle);
        expect(sessionId.length).toBeGreaterThan(0);
        const health = await fetchHealth(handle);
        expect(health.sessions).toBe(1);
      } finally {
        await handle.shutdown();
      }
    });
  });

  describe("HT.2: tools/list returns all 13 stdio-mode tools (discover gated on vector store)", () => {
    it("contains every expected tool name", async () => {
      const handle = await startHttp(makeConfig());
      try {
        const sessionId = await initializeSession(handle);
        const res = await postJsonRpc(handle, { jsonrpc: "2.0", id: 2, method: "tools/list" }, sessionId);
        expect(res.status).toBe(200);
        const payload = res.result as { result: { tools: Array<{ name: string }> } };
        const names = payload.result.tools.map((t) => t.name);
        for (const expected of [
          "search_recipes",
          "filter_by_ingredient",
          "filter_by_time",
          "list_categories",
          "read_recipe",
          "create_recipe",
          "update_recipe",
          "delete_recipe",
          "list_pantry",
          "get_pantry_item",
          "add_pantry_items",
          "update_pantry_item",
          "delete_pantry_item",
        ]) {
          expect(names).toContain(expected);
        }
      } finally {
        await handle.shutdown();
      }
    });
  });

  describe("HT.3: tools/call list_categories returns mocked data", () => {
    it("response text contains both mocked category names", async () => {
      const handle = await startHttp(makeConfig());
      try {
        const sessionId = await initializeSession(handle);
        const res = await postJsonRpc(
          handle,
          { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_categories", arguments: {} } },
          sessionId,
        );
        expect(res.status).toBe(200);
        const payload = res.result as {
          result: { content: Array<{ type: string; text: string }> };
        };
        const text = payload.result.content[0]?.text ?? "";
        expect(text).toContain("Main Dishes");
        expect(text).toContain("Desserts");
      } finally {
        await handle.shutdown();
      }
    });
  });

  describe("HT.4: two clients get independent session ids", () => {
    it("/healthz reports sessions === 2 after both initialize", async () => {
      const handle = await startHttp(makeConfig());
      try {
        const a = await initializeSession(handle);
        const b = await initializeSession(handle);
        expect(a).not.toBe(b);
        const health = await fetchHealth(handle);
        expect(health.sessions).toBe(2);
      } finally {
        await handle.shutdown();
      }
    });
  });

  describe("HT.5: DELETE /mcp evicts the session", () => {
    it("session count drops to 0 after a DELETE with the session id", async () => {
      const handle = await startHttp(makeConfig());
      try {
        const sessionId = await initializeSession(handle);
        const before = await fetchHealth(handle);
        expect(before.sessions).toBe(1);

        const del = await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
          method: "DELETE",
          headers: {
            accept: "application/json, text/event-stream",
            "mcp-session-id": sessionId,
          },
        });
        expect(del.status).toBe(200);

        const after = await fetchHealth(handle);
        expect(after.sessions).toBe(0);
      } finally {
        await handle.shutdown();
      }
    });
  });

  describe("HT.6: stale session id returns 404", () => {
    it("returns 404 for a request with an unknown mcp-session-id", async () => {
      const handle = await startHttp(makeConfig());
      try {
        const response = await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            "mcp-session-id": "00000000-0000-0000-0000-000000000000",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(response.status).toBe(404);
      } finally {
        await handle.shutdown();
      }
    });
  });

  describe("HT.7: non-initialize request without session id returns 400", () => {
    it("rejects a tools/list call that lacks both session id and initialize body", async () => {
      const handle = await startHttp(makeConfig());
      try {
        const response = await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
        });
        expect(response.status).toBe(400);
      } finally {
        await handle.shutdown();
      }
    });
  });

  describe("HT.8: GET /healthz returns ok with session count", () => {
    it("returns { ok: true, sessions: 0 } before any client connects", async () => {
      const handle = await startHttp(makeConfig());
      try {
        const response = await fetch(`http://127.0.0.1:${handle.port.toString()}/healthz`);
        expect(response.status).toBe(200);
        const body = (await response.json()) as { ok: boolean; sessions: number };
        expect(body.ok).toBe(true);
        expect(body.sessions).toBe(0);
      } finally {
        await handle.shutdown();
      }
    });
  });

  describe("HT.10: DNS rebinding protection toggles", () => {
    // @hono/mcp's StreamableHTTPTransport implements its own DNS rebinding
    // validation that is stricter than the upstream SDK's: when
    // allowedOrigins is non-empty, requests MUST carry an Origin header that
    // is in the list (missing Origin is rejected, not waved through). That
    // means MCP_ALLOWED_ORIGINS effectively requires a browser-shaped
    // client; CLI/SDK clients that don't send Origin would be locked out.
    // undici's fetch refuses to override the Host header, so we only
    // exercise the Origin path here.
    function initializeBody(): Record<string, unknown> {
      return {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "vitest", version: "0" },
        },
      };
    }

    it("rejects POST /mcp with a disallowed Origin header", async () => {
      const handle = await startHttp(
        makeConfig({
          http: {
            port: 0,
            host: "127.0.0.1",
            allowedHosts: [],
            allowedOrigins: ["https://allowed.example.test"],
            shutdownDrainMs: 0,
          },
        }),
      );
      try {
        const response = await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            origin: "https://evil.example.test",
          },
          body: JSON.stringify(initializeBody()),
        });
        expect(response.status).toBe(403);
      } finally {
        await handle.shutdown();
      }
    });

    it("rejects POST /mcp when allowedOrigins is set and no Origin header is sent", async () => {
      const handle = await startHttp(
        makeConfig({
          http: {
            port: 0,
            host: "127.0.0.1",
            allowedHosts: [],
            allowedOrigins: ["https://allowed.example.test"],
            shutdownDrainMs: 0,
          },
        }),
      );
      try {
        const response = await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
          },
          body: JSON.stringify(initializeBody()),
        });
        expect(response.status).toBe(403);
      } finally {
        await handle.shutdown();
      }
    });

    it("accepts POST /mcp with an allowed Origin header", async () => {
      const handle = await startHttp(
        makeConfig({
          http: {
            port: 0,
            host: "127.0.0.1",
            allowedHosts: [],
            allowedOrigins: ["https://allowed.example.test"],
            shutdownDrainMs: 0,
          },
        }),
      );
      try {
        const response = await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            origin: "https://allowed.example.test",
          },
          body: JSON.stringify(initializeBody()),
        });
        expect(response.status).toBe(200);
      } finally {
        await handle.shutdown();
      }
    });

    it("leaves all requests unchallenged when both lists are empty (default)", async () => {
      const handle = await startHttp(makeConfig());
      try {
        const response = await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json, text/event-stream",
            origin: "https://anywhere.example.test",
          },
          body: JSON.stringify(initializeBody()),
        });
        expect(response.status).toBe(200);
      } finally {
        await handle.shutdown();
      }
    });
  });

  describe("HT.9: graceful shutdown aborts open SSE streams within the timeout", () => {
    it("returns from shutdown() promptly and refuses further connections", async () => {
      const handle = await startHttp(makeConfig());
      const sessionId = await initializeSession(handle);
      const port = handle.port;

      // Open a long-lived SSE GET on the same session. The transport
      // multiplexes server→client notifications over this stream — without
      // proper shutdown handling, http.Server.close() would hang forever
      // waiting for it to terminate on its own.
      const sseController = new AbortController();
      const ssePromise = fetch(`http://127.0.0.1:${port.toString()}/mcp`, {
        method: "GET",
        headers: {
          accept: "text/event-stream",
          "mcp-session-id": sessionId,
        },
        signal: sseController.signal,
      }).catch(() => undefined);

      // Give the SSE stream a moment to actually open on the server side.
      await new Promise((r) => setTimeout(r, 50));

      const start = Date.now();
      await handle.shutdown();
      const elapsed = Date.now() - start;

      // Shutdown must finish well under the 10s hard timeout.
      expect(elapsed).toBeLessThan(9_000);

      // Subsequent connections must be refused — the server is fully down.
      let refused = false;
      try {
        await fetch(`http://127.0.0.1:${port.toString()}/healthz`);
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);

      sseController.abort();
      await ssePromise;
    });

    it("fails readiness (/healthz 503) during the pre-drain window, then refuses connections", async () => {
      const handle = await startHttp(
        makeConfig({
          http: { port: 0, host: "127.0.0.1", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 300 },
        }),
      );
      const port = handle.port;

      const before = await fetch(`http://127.0.0.1:${port.toString()}/healthz`);
      expect(before.status).toBe(200);

      // Begin shutdown but don't await — we're inside the 300ms readiness-drain
      // window, during which the server keeps serving but reports not-ready so
      // Kubernetes de-routes the pod before connections close.
      const shutdownPromise = handle.shutdown();

      const during = await fetch(`http://127.0.0.1:${port.toString()}/healthz`);
      expect(during.status).toBe(503);
      expect(await during.json()).toMatchObject({ ok: false, draining: true });

      await shutdownPromise;

      // After the drain completes the server is fully down.
      let refused = false;
      try {
        await fetch(`http://127.0.0.1:${port.toString()}/healthz`);
      } catch {
        refused = true;
      }
      expect(refused).toBe(true);
    });
  });
});

// ============================================================================
// OAuth wire tests — HTTP transport with OAuth mounted
// ============================================================================

function makeOAuthConfig(): PaprikaConfig {
  return fromAny({
    paprika: { email: "test@example.com", password: "secret" },
    sync: { enabled: false, interval: 60_000 },
    transport: "http",
    http: { port: 0, host: "127.0.0.1", allowedHosts: [], allowedOrigins: [], shutdownDrainMs: 0 },
    logging: SILENT_LOGGING_CONFIG,
    oauth: {
      publicUrl: PUBLIC_URL,
      preset: undefined,
      discoveryUrl: `${OIDC_ISSUER}/.well-known/openid-configuration`,
      scopes: ["openid", "email"],
      emailVerifiedPolicy: "strict",
      allowedAlgs: ["RS256"],
      clientId: "test-upstream-client",
      clientSecret: "test-upstream-secret",
      // Tests drive different x-forwarded-for values to exercise the per-IP
      // rate-limit window; with trustProxy=false the limiter would collapse
      // everyone into one bucket and AC5.1 / AC5.2 would interfere.
      trustProxy: true,
      allowlist: { emails: ["user@example.com"], subs: [] },
      redirectAllowlist: ["https://claude.ai"],
    },
  });
}

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

describe("HTTP transport — OAuth mounted", () => {
  // Single server instance shared across all OAuth wire tests.
  // This is an integration setup — uses beforeAll/afterAll with one handle.
  //
  // We manage a dedicated tempdir here (not relying on the outer beforeEach)
  // because the OAuth server is created once in beforeAll and must point at a
  // stable cache directory for its entire lifetime.  The outer beforeEach
  // tempdir is scoped per-test and gets deleted by afterEach — after C1 fixed
  // XDG_CACHE_HOME to be read dynamically, the server's DiskCache would point
  // at a deleted directory from test 2 onward if we didn't own the lifecycle.
  let oauthHandle: HttpTransportHandle;
  let oauthPort: number;
  const oauthXdg = useXdgIsolation("mcp-paprika-oauth");

  beforeAll(async () => {
    // Allocate a dedicated tempdir that lives for the whole OAuth suite.
    await oauthXdg.setup();

    // Note: oidcStub handlers are already registered at module scope as permanent
    // handlers via useMswServer(), so the OAuth tests inherit them.
    const config = makeOAuthConfig();
    oauthHandle = await startHttp(config);
    oauthPort = oauthHandle.port;
  });

  afterAll(async () => {
    await oauthHandle.shutdown();
    // Restore env vars and clean up the dedicated tempdir.
    await oauthXdg.teardown();
  });

  describe("OA.1/AC2.1+AC6.1: OAuth authorization server metadata", () => {
    it("AC2.1/AC6.1: GET /.well-known/oauth-authorization-server returns customized metadata with exact issuer", async () => {
      // PLAN says (phase_07.md:513-521): issuer must be exact PUBLIC_URL (no trailing slash);
      // token_endpoint_auth_methods_supported must be ["none"]; code_challenge_methods_supported
      // must be ["S256"]; id_token_signing_alg_values_supported must NOT be present.
      const res = await fetch(`http://127.0.0.1:${oauthPort.toString()}/.well-known/oauth-authorization-server`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body["issuer"]).toBe(PUBLIC_URL); // AC6.1: exact issuer, no trailing slash
      expect(body["token_endpoint_auth_methods_supported"]).toEqual(["none"]); // AC2.1: public client
      expect(body["code_challenge_methods_supported"]).toEqual(["S256"]);
      expect(body["authorization_response_iss_parameter_supported"]).toBe(true);
      expect(body).not.toHaveProperty("id_token_signing_alg_values_supported"); // AC2.13
    });
  });

  describe("OA.2/AC2.2: Protected resource metadata", () => {
    it("AC2.2: GET /.well-known/oauth-protected-resource returns RFC 9728 doc", async () => {
      // PLAN says (phase_07.md:524): protected-resource doc advertises resource = issuer
      const res = await fetch(`http://127.0.0.1:${oauthPort.toString()}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(typeof body["resource"]).toBe("string");
      expect(body["authorization_servers"]).toBeDefined();
    });
  });

  describe("OA.3/AC2.13: No forbidden metadata values", () => {
    it("AC2.13: scan all published metadata for forbidden 'none' or non-S256 PKCE", async () => {
      // PLAN says (phase_07.md:527-537): no 'none' alg, only S256 PKCE method
      const authMeta = (await fetch(
        `http://127.0.0.1:${oauthPort.toString()}/.well-known/oauth-authorization-server`,
      ).then((r) => r.json())) as Record<string, unknown>;
      const resMeta = (await fetch(
        `http://127.0.0.1:${oauthPort.toString()}/.well-known/oauth-protected-resource`,
      ).then((r) => r.json())) as Record<string, unknown>;

      function collectLeafValues(obj: unknown): Array<unknown> {
        if (Array.isArray(obj)) return obj.flatMap(collectLeafValues);
        if (typeof obj === "object" && obj !== null) return Object.values(obj).flatMap(collectLeafValues);
        return [obj];
      }

      // "none" may appear in token_endpoint_auth_methods_supported (public client), but never
      // as an algorithm value (id_token_signing_alg_values_supported must not be present).
      // The protected-resource doc must have zero "none" values.
      const authNoneCount = collectLeafValues(authMeta).filter((v) => v === "none").length;
      const resNoneCount = collectLeafValues(resMeta).filter((v) => v === "none").length;
      // Exactly 1 "none" in AS metadata (token_endpoint_auth_methods_supported)
      expect(authNoneCount).toBeLessThanOrEqual(1);
      expect(resNoneCount).toBe(0);

      // code_challenge_methods_supported must only contain "S256"
      const pkce = authMeta["code_challenge_methods_supported"] as Array<string> | undefined;
      if (pkce !== undefined) {
        expect(pkce.every((m) => m === "S256")).toBe(true);
      }
    });
  });

  describe("OA.4/AC1.1+AC2.6: Dynamic client registration", () => {
    it("AC1.1/AC2.6: POST /register returns 201 with client_id + registration_access_token; no client_secret", async () => {
      // PLAN says (phase_07.md:540-551): DCR creates a public client without client_secret
      const body = makeClaudeAiRegistration();
      const res = await fetch(`http://127.0.0.1:${oauthPort.toString()}/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(res.status).toBe(201);
      const doc = (await res.json()) as Record<string, unknown>;
      expect(typeof doc["client_id"]).toBe("string");
      expect((doc["client_id"] as string).length).toBeGreaterThan(0);
      expect(typeof doc["registration_access_token"]).toBe("string");
      expect((doc["registration_access_token"] as string).startsWith("mcp_rat_")).toBe(true);
      expect(doc).not.toHaveProperty("client_secret");
    });
  });

  describe("OA.5/AC1.5: Missing Authorization header → 401", () => {
    it("AC1.5: POST /mcp without Authorization header returns 401 with WWW-Authenticate Bearer header", async () => {
      // PLAN says (phase_07.md:554-562): bearerAuth middleware rejects unauthenticated /mcp requests
      const res = await fetch(`http://127.0.0.1:${oauthPort.toString()}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      expect(res.status).toBe(401);
      const wwwAuth = res.headers.get("www-authenticate") ?? "";
      expect(wwwAuth).toContain("Bearer");
      // PLAN says (phase_07.md:554-562): WWW-Authenticate header must contain resource_metadata
      // per RFC 9110 / RFC 9728 so clients can discover the protected-resource document.
      expect(wwwAuth).toContain("resource_metadata=");
      // The resource_metadata URL must point at the well-known protected-resource endpoint.
      expect(wwwAuth).toContain("/.well-known/oauth-protected-resource");
    });
  });

  describe("OA.6/AC1.6: Malformed token → 401", () => {
    it("AC1.6: POST /mcp with unknown token returns 401; body does not echo the token", async () => {
      // PLAN says (phase_07.md:565-573): invalid tokens are rejected without leaking token value
      const fakeToken = "mcp_at_invalidtokenxxxxx";
      const res = await fetch(`http://127.0.0.1:${oauthPort.toString()}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${fakeToken}`,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
      expect(res.status).toBe(401);
      const body = await res.text();
      expect(body).not.toContain(fakeToken);
    });
  });

  describe("AC5.1: DCR rate-limit mounted on startHttp server", () => {
    it("AC5.1: 10x POST /register from same IP succeeds; 11th returns 429", async () => {
      // PLAN says (phase_07.md:584): wire-level smoke that buildDcrRateLimit() is mounted.
      // Uses a fresh IP (203.0.113.7) distinct from other OAuth tests to start with a clean bucket.
      const registrationBody = makeClaudeAiRegistration();
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.7",
      };
      for (let i = 0; i < 10; i++) {
        const res = await fetch(`http://127.0.0.1:${oauthPort.toString()}/register`, {
          method: "POST",
          headers,
          body: JSON.stringify(registrationBody),
        });
        expect(res.status).toBe(201);
      }
      // 11th registration from the same IP must be rate-limited.
      const limited = await fetch(`http://127.0.0.1:${oauthPort.toString()}/register`, {
        method: "POST",
        headers,
        body: JSON.stringify(registrationBody),
      });
      expect(limited.status).toBe(429);
    });
  });

  describe("AC5.2: Client cap mounted on startHttp server", () => {
    it("AC5.2: with 50 registered clients in cache, POST /register returns 429 with cap error", async () => {
      // PLAN says (phase_07.md:584): wire-level smoke that buildClientCap is mounted.
      // Seed the cache directly via DiskCache (bypassing HTTP rate-limit) so the cap
      // check sees >= 50 existing clients.  buildClientCap reads cache.getAllOAuthClients()
      // on every POST /register — fresh disk files are visible on the very next call.
      const cacheDir = join(oauthXdg.dir(), "mcp-paprika");
      const seedCache = new DiskCacheRoot(cacheDir);
      await seedCache.init();

      // Count existing clients (from other tests in this suite).
      const existing = await seedCache.oauthClients.getAll();
      const needed = 50 - existing.length;
      for (let i = 0; i < needed; i++) {
        await seedCache.oauthClients.put(makeOAuthClient());
      }
      await seedCache.flush();

      // Now the server sees >= 50 clients; the next registration must be capped.
      const res = await fetch(`http://127.0.0.1:${oauthPort.toString()}/register`, {
        method: "POST",
        // Use a fresh IP to avoid the rate-limit bucket from AC5.1.
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.99" },
        body: JSON.stringify(makeClaudeAiRegistration()),
      });
      expect(res.status).toBe(429);
      const doc = (await res.json()) as Record<string, unknown>;
      // buildClientCap returns { error: "invalid_request", error_description: "client registration cap reached" }
      expect(doc["error_description"]).toContain("cap");
    });
  });
});

// ---------------------------------------------------------------------------
// accessLog middleware unit tests (structured-logging.AC9.5)
// Unit tests exercise the accessLog factory in isolation using stub Hono
// Context objects. Integration tests below (AC9.5-integration) boot the real
// startHttp app and verify the router-placement contract.
// ---------------------------------------------------------------------------

describe("accessLog middleware (AC9.5)", () => {
  function makeStubContext(method: string, path: string, status: number): import("hono").Context {
    return fromAny({
      req: { method, path },
      res: { status },
    });
  }

  function makeNext() {
    return async (): Promise<void> => {};
  }

  it("AC9.5: emits one info record for a 200 response", async () => {
    const { log, records } = makePinoCapture();
    const middleware = accessLog(log);
    const ctx = makeStubContext("GET", "/mcp", 200);

    await middleware(ctx, makeNext());

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.["level"]).toBe(30); // pino info = 30
    expect(record?.["method"]).toBe("GET");
    expect(record?.["path"]).toBe("/mcp");
    expect(record?.["status"]).toBe(200);
    expect(typeof record?.["durationMs"]).toBe("number");
    expect((record?.["durationMs"] as number) >= 0).toBe(true);
    expect(record?.["msg"]).toBe("http request");
  });

  it("AC9.5: does not emit a record for GET /healthz (health probe excluded from access log)", async () => {
    const { log, records } = makePinoCapture();
    const middleware = accessLog(log);
    const ctx = makeStubContext("GET", "/healthz", 200);

    await middleware(ctx, makeNext());

    expect(records).toHaveLength(0);
  });

  it("AC9.5: emits one error record for a 500 response", async () => {
    const { log, records } = makePinoCapture();
    const middleware = accessLog(log);
    const ctx = makeStubContext("POST", "/mcp", 500);

    await middleware(ctx, makeNext());

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.["level"]).toBe(50); // pino error = 50
    expect(record?.["method"]).toBe("POST");
    expect(record?.["path"]).toBe("/mcp");
    expect(record?.["status"]).toBe(500);
    expect(record?.["msg"]).toBe("http request 5xx");
  });

  it("AC9.5: emits one info record (not error) for a 401 response", async () => {
    const { log, records } = makePinoCapture();
    const middleware = accessLog(log);
    const ctx = makeStubContext("POST", "/mcp", 401);

    await middleware(ctx, makeNext());

    expect(records).toHaveLength(1);
    const record = records[0];
    expect(record?.["level"]).toBe(30); // pino info = 30, not error (50)
    expect(record?.["status"]).toBe(401);
    expect(record?.["msg"]).toBe("http request");
  });

  it("AC9.5: concurrent requests each emit exactly one record without duplication", async () => {
    const { log, records } = makePinoCapture();
    const middleware = accessLog(log);

    const ctx1 = makeStubContext("GET", "/register", 200);
    const ctx2 = makeStubContext("POST", "/mcp", 200);

    await Promise.all([middleware(ctx1, makeNext()), middleware(ctx2, makeNext())]);

    expect(records).toHaveLength(2);
    // Each request produced exactly one record — no duplication.
    const paths = records.map((r) => r["path"]);
    expect(paths).toContain("/register");
    expect(paths).toContain("/mcp");
  });

  it("AC9.5: emits a record and re-propagates when next() itself throws", async () => {
    // Defense-in-depth: even if a downstream middleware re-throws past Hono's
    // onError (bypassing Hono's normal error-to-500 conversion), accessLog
    // must still emit a record via its finally branch. The thrown error
    // continues to propagate so upstream error handlers can act on it.
    const { log, records } = makePinoCapture();
    const middleware = accessLog(log);
    const ctx = makeStubContext("GET", "/will-throw", 500);
    const failingNext = async (): Promise<void> => {
      throw new Error("downstream middleware rethrew");
    };

    await expect(middleware(ctx, failingNext)).rejects.toThrow("downstream middleware rethrew");

    expect(records).toHaveLength(1);
    expect(records[0]!["path"]).toBe("/will-throw");
    expect(records[0]!["method"]).toBe("GET");
    expect(records[0]!["status"]).toBe(500);
    expect(records[0]!["level"]).toBe(50); // error
  });
});

// ---------------------------------------------------------------------------
// Integration tests: accessLog placement via real startHttp router (AC9.5-integration)
//
// These boot the real app with an injected test logger to verify that the
// accessLog middleware is mounted BEFORE /healthz in Hono's route chain, but
// health probe paths are explicitly excluded so k8s liveness polls do not
// flood the structured log. The unit tests above bypass Hono's router entirely
// and cannot catch middleware placement bugs.
// ---------------------------------------------------------------------------

describe("accessLog middleware placement — integration (AC9.5-integration)", () => {
  it("AC9.5-int-1: GET /healthz is served correctly but does not emit an access-log record", async () => {
    const { log, records } = makePinoCapture();
    // _testLog injects the capture logger as the transport-level logger used by accessLog.
    const opts: StartHttpOptions = { _testLog: log };
    const handle = await startHttp(makeConfig(), opts);
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port.toString()}/healthz`);

      // Health probe is served (200 ok) but must not produce a log record.
      expect(res.status).toBe(200);
      const healthzRecords = records.filter((r) => r["path"] === "/healthz");
      expect(healthzRecords).toHaveLength(0);
    } finally {
      await handle.shutdown();
    }
  });

  it("AC9.5-int-2: POST /mcp without session id emits an access-log record for /mcp", async () => {
    // Confirms accessLog also runs for /mcp (not just /healthz). A POST /mcp
    // with no session id and a non-initialize body returns 400 — info level.
    // The 5xx fan-out path (error level → notifier multistream) is covered
    // by structural inspection: accessLog is constructed from
    // `app.log.child({component: "transport-http"})` and `app.log` carries
    // the notifier-backed multistream, so error records automatically fan out.
    // The multistream wiring itself is tested in src/utils/log.test.ts.
    const { log, records } = makePinoCapture();
    const opts: StartHttpOptions = { _testLog: log };
    const handle = await startHttp(makeConfig(), opts);
    try {
      await fetch(`http://127.0.0.1:${handle.port.toString()}/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

      const mcpRecords = records.filter((r) => r["path"] === "/mcp");
      expect(mcpRecords.length).toBeGreaterThan(0);
      const r = mcpRecords[0]!;
      expect(r["method"]).toBe("POST");
      expect(r["status"]).toBe(400);
      expect(r["level"]).toBe(30); // info; 5xx would be error (50)
    } finally {
      await handle.shutdown();
    }
  });

  it("AC9.5-int-3: 5xx response through real Hono router emits error-level access-log record", async () => {
    // Drives a real 5xx through Hono's router (not a stub Context) by mounting
    // accessLog on a fresh Hono app, then registering a route that throws.
    // Hono's default error handler converts the throw into a 500 response;
    // accessLog observes c.res.status === 500 after next() returns and emits
    // an error-level record. This proves the placement-via-router contract
    // for the 5xx path that AC9.5 calls out (fan-out condition: error level
    // >= default notifyLevel "warn", structurally guaranteed by the multistream
    // that app.log carries in production).
    const { log, records } = makePinoCapture();
    const app = new Hono();
    app.use("*", accessLog(log));
    app.get("/boom", () => {
      throw new Error("simulated server failure");
    });

    const res = await app.request("/boom");
    expect(res.status).toBe(500);

    const boomRecords = records.filter((r) => r["path"] === "/boom");
    expect(boomRecords).toHaveLength(1);
    const r = boomRecords[0]!;
    expect(r["method"]).toBe("GET");
    expect(r["status"]).toBe(500);
    expect(r["level"]).toBe(50); // pino numeric level for error
    expect(r["msg"]).toBe("http request 5xx");
    expect(typeof r["durationMs"]).toBe("number");
  });
});
