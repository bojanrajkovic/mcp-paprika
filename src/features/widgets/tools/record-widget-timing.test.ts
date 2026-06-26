import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useKernelHarness } from "../../../../test/support/kernel-harness.js";
import { installTestTelemetry } from "../../../../test/support/telemetry-test-utils.js";
import { getText } from "../../../../test/support/tool-test-utils.js";
import { recordSessionId } from "../../../telemetry/client-fingerprint.js";
import { ATTR_MCP_SESSION_ID } from "../../../telemetry/semconv.js";

// Module scope, before any recording (the shared instruments memoize on first use).
const telemetry = installTestTelemetry();

/** HrTime `[seconds, nanos]` → milliseconds. */
function ms(hr: readonly [number, number]): number {
  return hr[0] * 1000 + hr[1] / 1e6;
}

const TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
const SPAN_ID = "b7ad6b7169203331";
const TRACEPARENT = `00-${TRACE_ID}-${SPAN_ID}-01`;

describe("record_widget_timing", () => {
  const kh = useKernelHarness("widgets");
  beforeEach(async () => {
    await kh.setup();
    telemetry.spanExporter.reset();
  });
  afterEach(kh.teardown);

  it("emits a child span per measure, parented under the smuggled read span", async () => {
    const result = await kh.callTool("record_widget_timing", {
      traceparent: TRACEPARENT,
      timeOrigin: 1_000_000,
      clientReportTime: 1_000_500,
      measures: [
        { name: "paprika-widget:boot-to-connected", startTime: 10, duration: 40 },
        { name: "paprika-widget:boot-to-mounted", startTime: 10, duration: 80 },
      ],
    });
    expect(getText(result)).toContain("recorded");

    const connected = telemetry.spansNamed("paprika-widget:boot-to-connected");
    const mounted = telemetry.spansNamed("paprika-widget:boot-to-mounted");
    expect(connected).toHaveLength(1);
    expect(mounted).toHaveLength(1);

    // Children of the READ span the traceparent encodes — same trace, parented to its span
    // id — NOT the record_widget_timing tool span (which is a different local-root trace).
    for (const span of [connected[0]!, mounted[0]!]) {
      expect(span.spanContext().traceId).toBe(TRACE_ID);
      expect(span.parentSpanContext?.spanId).toBe(SPAN_ID);
    }
    // Durations survive the clock-skew correction (the skew cancels in end − start).
    expect(ms(connected[0]!.duration)).toBeCloseTo(40, 1);
    expect(ms(mounted[0]!.duration)).toBeCloseTo(80, 1);
  });

  it("stamps mcp.session.id on the render spans when the session is known", async () => {
    recordSessionId(kh.server().server, "sess-widget-1");
    await kh.callTool("record_widget_timing", {
      traceparent: TRACEPARENT,
      timeOrigin: 1_000_000,
      clientReportTime: 1_000_000,
      measures: [{ name: "paprika-widget:boot-to-mounted", startTime: 0, duration: 5 }],
    });
    const span = telemetry.spansNamed("paprika-widget:boot-to-mounted")[0]!;
    expect(span.attributes[ATTR_MCP_SESSION_ID]).toBe("sess-widget-1");
  });

  it("clamps a garbage timeOrigin/duration so it cannot overflow the OTLP epoch", async () => {
    await kh.callTool("record_widget_timing", {
      traceparent: TRACEPARENT,
      timeOrigin: 1e300, // absurd client clock
      clientReportTime: 1_000,
      measures: [{ name: "paprika-widget:boot-to-mounted", startTime: 0, duration: 1e300 }],
    });
    const span = telemetry.spansNamed("paprika-widget:boot-to-mounted")[0]!;
    // Duration clamped to the render window, not 1e300.
    expect(ms(span.duration)).toBe(600_000);
    // Start anchored near the server clock (seconds), never a ~1e297 overflow.
    expect(span.startTime[0]).toBeGreaterThan(0);
    expect(span.startTime[0]).toBeLessThan(Date.now() / 1000 + 86_400);
  });

  it("degrades a malformed traceparent to a local-root span without throwing", async () => {
    const result = await kh.callTool("record_widget_timing", {
      traceparent: "not-a-traceparent",
      timeOrigin: 1_000_000,
      clientReportTime: 1_000_000,
      measures: [{ name: "paprika-widget:boot-to-mounted", startTime: 0, duration: 5 }],
    });
    expect(getText(result)).toContain("recorded");
    const span = telemetry.spansNamed("paprika-widget:boot-to-mounted")[0]!;
    // extract() returned ROOT_CONTEXT for the garbage value → no parent.
    expect(span.parentSpanContext).toBeUndefined();
  });
});
