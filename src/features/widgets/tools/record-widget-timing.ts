import { defaultTextMapGetter, ROOT_CONTEXT, SpanKind } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { WidgetsState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { toolResult } from "../../../shared/tools.js";
import { sessionAttrs } from "../../../telemetry/client-fingerprint.js";
import { getTracer } from "../../../telemetry/scope.js";

/**
 * Explicit W3C propagator — the global one is `OTEL_PROPAGATORS=none` (its
 * `extract` no-ops). `extract` validates the traceparent and, on a malformed value,
 * returns the base context UNCHANGED, so a forged/garbage report degrades to a fresh
 * local root rather than throwing — the untrusted-input safety the design relies on.
 */
const propagator = new W3CTraceContextPropagator();

/**
 * Render-timeline span window. The widget's `timeOrigin`/marks/durations are untrusted (a host owns the
 * iframe), so a forged or drifted value could otherwise hand OTel an epoch that overflows the OTLP int64
 * and corrupts the export batch. Clamping every client time into ±this window of the server clock is
 * transparent to an honest sub-second render and bounds the damage of garbage. 10 min is generous slack.
 */
const MAX_RENDER_MS = 600_000;
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** One reported render interval — a `performance.measure` the widget collected, offset from its `timeOrigin`. */
const measureSchema = z.object({
  name: z.string().min(1).max(128),
  startTime: z.number().finite().nonnegative(),
  duration: z.number().finite().nonnegative(),
});

export const recordWidgetTimingInputSchema = z.object({
  traceparent: z.string().max(256),
  timeOrigin: z.number().finite().positive(),
  clientReportTime: z.number().finite().positive(),
  measures: z.array(measureSchema).max(64),
});

/**
 * `record_widget_timing` — the server-side sink for a widget's client-side render timeline.
 *
 * A rendered widget reports `{ traceparent, timeOrigin, clientReportTime, measures }` after paint:
 * the traceparent the `resources/read` smuggled into its HTML, plus the `performance.measure`
 * intervals it collected (parse/eval, handshake, data-delivery, render). This re-parents those
 * intervals as child spans under that read span, so the render timeline appears in Tempo under the
 * read that served the widget — no `@opentelemetry/*` in the bundle; the server emits on its behalf.
 *
 * APP-ONLY (`ui.visibility: ["app"]`): callable by a widget via `callServerTool`, hidden from the
 * model's `tools/list` where the host honors visibility. `readOnlyHint` + the description are
 * defense-in-depth for hosts that don't.
 *
 * Clock skew: the iframe's `timeOrigin`/marks are on the CLIENT clock; the parent span is on the
 * SERVER clock. `skew = serverReceiveTime − clientReportTime` anchors the client timeline to the
 * server clock at the report instant, so the children sit correctly under the parent.
 */
export const recordWidgetTimingTool = defineTool(
  {
    name: "record_widget_timing",
    title: "Record widget render timing (internal)",
    annotations: { readOnlyHint: true },
    description:
      "Internal telemetry sink. A rendered widget reports its own render-timing marks here " +
      "automatically after paint; agents never call this.",
    inputSchema: recordWidgetTimingInputSchema.shape,
    ui: { visibility: ["app"] },
  },
  (ctx: DomainCtx<WidgetsState, never>) => {
    return async (args) => {
      // The read span the widget's HTML carried — the parent for its render spans. Invalid →
      // ROOT_CONTEXT, so the spans become local roots (safe degrade).
      const parent = propagator.extract(ROOT_CONTEXT, { traceparent: args.traceparent }, defaultTextMapGetter);
      const tracer = getTracer();
      const attributes = sessionAttrs(ctx.server.server);
      const serverNow = Date.now();
      for (const measure of args.measures) {
        // Anchor the client timeline to the server clock at the report instant — `start = serverNow +
        // (clientMeasureStart − clientReportTime)`, the skew correction — then CLAMP both the offset
        // (a measure started at most MAX_RENDER_MS ago, no later than now) and the duration. Algebraically
        // identical to the raw skew formula for honest sub-second data; the clamp only bites on garbage.
        const start = serverNow + clamp(measure.startTime + args.timeOrigin - args.clientReportTime, -MAX_RENDER_MS, 0);
        const duration = clamp(measure.duration, 0, MAX_RENDER_MS);
        tracer
          .startSpan(measure.name, { startTime: start, kind: SpanKind.INTERNAL, attributes }, parent)
          .end(start + duration);
      }
      return toolResult("recorded");
    };
  },
);
