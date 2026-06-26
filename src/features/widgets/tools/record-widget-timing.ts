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
 * `record_widget_timing` — the server-side sink for a widget's client-side render timeline (0b).
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
      const skew = Date.now() - args.clientReportTime;
      const tracer = getTracer();
      const attributes = sessionAttrs(ctx.server.server);
      for (const measure of args.measures) {
        // Client epoch (timeOrigin + offset) shifted onto the server clock by the skew.
        const start = args.timeOrigin + measure.startTime + skew;
        tracer
          .startSpan(measure.name, { startTime: start, kind: SpanKind.INTERNAL, attributes }, parent)
          .end(start + measure.duration);
      }
      return toolResult("recorded");
    };
  },
);
