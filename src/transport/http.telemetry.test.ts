import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { tracedRequests } from "./http.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();

function appWithRoutes(trustProxy = false): Hono {
  const app = new Hono();
  app.use("*", tracedRequests(trustProxy));
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.all("/mcp", (c) => c.text("mcp"));
  app.get("/other", (c) => c.text("other"));
  return app;
}

beforeEach(() => {
  telemetry.spanExporter.reset();
});

describe("tracedRequests", () => {
  it("creates a SERVER span for ordinary requests", async () => {
    const app = appWithRoutes();
    await app.request("/other");

    const spans = telemetry.spanExporter.getFinishedSpans();
    expect(spans.length).toBe(1);
    expect(spans[0]!.attributes["http.request.method"]).toBe("GET");
  });

  it("creates a span for POST /mcp (the JSON-RPC exchanges)", async () => {
    const app = appWithRoutes();
    await app.request("/mcp", { method: "POST", body: "{}" });

    expect(telemetry.spanExporter.getFinishedSpans().length).toBe(1);
  });

  it("skips the probe path and the long-lived SSE GET /mcp stream", async () => {
    const app = appWithRoutes();
    await app.request("/healthz");
    await app.request("/mcp"); // GET — the SSE stream

    expect(telemetry.spanExporter.getFinishedSpans()).toEqual([]);
  });

  it("tags the span with user_agent.original and the captured request headers", async () => {
    const app = appWithRoutes();
    await app.request("/other", {
      headers: { "user-agent": "claude/1.0", origin: "https://claude.ai", "accept-language": "en-US" },
    });

    const span = telemetry.spanExporter.getFinishedSpans()[0]!;
    expect(span.attributes["user_agent.original"]).toBe("claude/1.0");
    expect(span.attributes["http.request.header.origin"]).toBe("https://claude.ai");
    expect(span.attributes["http.request.header.accept-language"]).toBe("en-US");
  });

  it("trusts x-forwarded-for for client.address ONLY when trustProxy is set", async () => {
    // Behind a trusted proxy: the leftmost forwarded hop is the real client.
    const trusting = appWithRoutes(true);
    await trusting.request("/other", { headers: { "x-forwarded-for": "203.0.113.5, 198.51.100.1" } });
    expect(telemetry.spanExporter.getFinishedSpans()[0]!.attributes["client.address"]).toBe("203.0.113.5");

    // Directly exposed: a forged header is ignored, and the in-memory adapter has
    // no socket peer, so client.address is simply unset (never the spoofed value).
    telemetry.spanExporter.reset();
    const direct = appWithRoutes(false);
    await direct.request("/other", { headers: { "x-forwarded-for": "203.0.113.5" } });
    expect(telemetry.spanExporter.getFinishedSpans()[0]!.attributes["client.address"]).toBeUndefined();
  });
});
