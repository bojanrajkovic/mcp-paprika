import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startHttp, type HttpTransportHandle } from "./http.js";
import type { PaprikaConfig } from "../utils/config.js";
import { createOidcStub } from "../auth/__fixtures__/oidc-stub.js";

/**
 * These tests drive the HTTP transport with raw `fetch`, not the MCP SDK
 * client. Two reasons: (1) MSW's request interceptor in this test setup
 * already proxies the SDK client's outbound calls in unexpected ways when
 * the target is 127.0.0.1, and (2) raw fetch lets us assert the exact wire
 * shape we care about (status codes, `mcp-session-id` header, SSE framing)
 * without the SDK client layering opinions on top.
 */

const PAPRIKA_API_BASE = "https://paprikaapp.com/api/v2/sync";
const PAPRIKA_AUTH_URL = "https://paprikaapp.com/api/v1/account/login/";

const msw = setupServer();
let tempCacheDir: string;
let originalXdgCache: string | undefined;
let originalXdgConfig: string | undefined;

function makeConfig(overrides: Partial<PaprikaConfig> = {}): PaprikaConfig {
  // transport: "stdio" — buildAuthContext returns null for stdio, so these tests
  // don't need an oauth block. The transport field doesn't affect how startHttp
  // operates (it's already in HTTP mode by being called at all).
  return {
    paprika: { email: "test@example.com", password: "secret" },
    sync: { enabled: false, interval: 60_000 },
    transport: "stdio",
    http: { port: 0, host: "127.0.0.1" },
    ...overrides,
  } as PaprikaConfig;
}

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
    http.post(PAPRIKA_AUTH_URL, () => HttpResponse.json({ result: { token: "test-token" } })),
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
    http.get(`${PAPRIKA_API_BASE}/pantry/`, () => HttpResponse.json({ result: [] })),
  ];
}

beforeAll(() => {
  msw.listen({ onUnhandledRequest: "bypass" });
});

afterAll(() => {
  msw.close();
});

beforeEach(async () => {
  msw.resetHandlers();
  msw.use(...paprikaMockHandlers());
  tempCacheDir = await mkdtemp(join(tmpdir(), "mcp-paprika-http-"));
  originalXdgCache = process.env["XDG_CACHE_HOME"];
  originalXdgConfig = process.env["XDG_CONFIG_HOME"];
  process.env["XDG_CACHE_HOME"] = tempCacheDir;
  process.env["XDG_CONFIG_HOME"] = tempCacheDir;
});

afterEach(async () => {
  if (originalXdgCache === undefined) delete process.env["XDG_CACHE_HOME"];
  else process.env["XDG_CACHE_HOME"] = originalXdgCache;
  if (originalXdgConfig === undefined) delete process.env["XDG_CONFIG_HOME"];
  else process.env["XDG_CONFIG_HOME"] = originalXdgConfig;
  await rm(tempCacheDir, { recursive: true, force: true });
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
          "add_pantry_item",
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
  });
});

// ============================================================================
// OAuth wire tests — HTTP transport with OAuth mounted
// ============================================================================

const OIDC_ISSUER = "https://accounts.example.test";
const PUBLIC_URL = "https://mcp.example.test";

function makeOAuthConfig(): PaprikaConfig {
  return {
    paprika: { email: "test@example.com", password: "secret" },
    sync: { enabled: false, interval: 60_000 },
    transport: "http",
    http: { port: 0, host: "127.0.0.1" },
    oauth: {
      publicUrl: PUBLIC_URL,
      preset: undefined,
      discoveryUrl: `${OIDC_ISSUER}/.well-known/openid-configuration`,
      scopes: ["openid", "email"],
      emailVerifiedPolicy: "strict",
      allowedAlgs: ["RS256"],
      clientId: "test-upstream-client",
      clientSecret: "test-upstream-secret",
      allowlist: { emails: ["user@example.com"], subs: [] },
    },
  } as unknown as PaprikaConfig;
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
  let oauthHandle: HttpTransportHandle;
  let oauthPort: number;

  beforeAll(async () => {
    const oidcStub = createOidcStub({
      issuer: OIDC_ISSUER,
      clientId: "test-upstream-client",
      clientSecret: "test-upstream-secret",
      defaultIdentity: { email: "user@example.com", sub: "google-user-1", emailVerified: true },
    });
    // Add OIDC stub handlers alongside the existing Paprika mock handlers
    // (which are already registered via beforeEach in the outer suite).
    msw.use(...oidcStub.handlers);
    const config = makeOAuthConfig();
    oauthHandle = await startHttp(config);
    oauthPort = oauthHandle.port;
  });

  afterAll(async () => {
    await oauthHandle.shutdown();
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
});
