import { Hono } from "hono";
import { beforeEach, describe, expect, it } from "vitest";

import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { tracedRequests } from "./http.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();

function appWithRoutes(): Hono {
  const app = new Hono();
  app.use("*", tracedRequests());
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
});
