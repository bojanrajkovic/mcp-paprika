import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { buildDcrRateLimit } from "./routes.js";
import { ATTR_AUTH_ENDPOINT, ATTR_AUTH_REASON } from "./telemetry.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();

const RATE_LIMITED = {
  [ATTR_AUTH_ENDPOINT]: "register",
  [ATTR_AUTH_REASON]: "rate_limited",
};

async function register(app: Hono, ip: string): Promise<Response> {
  return app.request("/register", {
    method: "POST",
    headers: { "x-forwarded-for": ip, "content-type": "application/json" },
    body: JSON.stringify({ client_name: "c", redirect_uris: ["https://x/"] }),
  });
}

// Counters are cumulative within the file, so the no-record case must run
// before the records case — keep these two in this order.
describe("buildDcrRateLimit failure attribution", () => {
  it("does not record rate_limited for a downstream 429 (the client cap's rejection)", async () => {
    const app = new Hono();
    app.use("/register", buildDcrRateLimit({ trustProxy: true }));
    // Stand-in for buildClientCap, mounted after the limiter on /register:
    // the downstream chain answers 429 itself (recorded there as cap_reached).
    app.post("/register", (c) => c.json({ error: "invalid_request" }, 429));

    const res = await register(app, "203.0.113.50");
    expect(res.status).toBe(429);

    expect(await telemetry.sumPoints("mcp_paprika.auth.failures", RATE_LIMITED)).toHaveLength(0);
  });

  it("records rate_limited when the limiter itself rejects", async () => {
    const app = new Hono();
    app.use("/register", buildDcrRateLimit({ trustProxy: true }));
    app.post("/register", (c) => c.json({ ok: true }, 201));

    for (let i = 0; i < 11; i++) await register(app, "203.0.113.51");

    const points = await telemetry.sumPoints("mcp_paprika.auth.failures", RATE_LIMITED);
    expect(points).toHaveLength(1);
    expect(points[0]?.value).toBe(1);
  });
});
