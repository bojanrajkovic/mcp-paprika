import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startHttp, type HttpTransportHandle } from "./http.js";
import type { PaprikaConfig } from "../utils/config.js";

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
  return {
    paprika: { email: "test@example.com", password: "secret" },
    sync: { enabled: false, interval: 60_000 },
    transport: "http",
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
