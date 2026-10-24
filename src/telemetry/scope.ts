// The one instrumentation scope every seam records under. Seams reach the
// tracer/meter through the global `@opentelemetry/api` singletons rather than
// an `Infra` field: the API is designed as a process-wide ambient
// with a safe no-op default — exactly the "off by default" property the
// bootstrap relies on — and it keeps telemetry out of signatures in layers
// that deliberately import nothing heavy (`src/entity/`, `src/cache/`).

import { type Meter, metrics, trace, type Tracer } from "@opentelemetry/api";
import type { Logger } from "pino";

/** Instrumentation scope name shared by every span and instrument this server emits. */
export const TELEMETRY_SCOPE = "mcp-paprika";

export function getTracer(): Tracer {
  return trace.getTracer(TELEMETRY_SCOPE);
}

export function getMeter(): Meter {
  return metrics.getMeter(TELEMETRY_SCOPE);
}

let diagLogTarget: Logger | undefined;

/**
 * Where `sdk.ts`'s OTel diag logger writes once the app's log destination is known.
 * The diag logger is installed in the telemetry preload, before config or any
 * logger exists, so the composition root sets this right after it builds the app
 * logger. Until then, diag lines go to a bare stderr logger. The target is a bare
 * pino logger on the app's destination, NOT the app logger itself: the app
 * logger fans warn+ records out to connected MCP clients, and exporter noise must
 * stay operator-only.
 */
export function setDiagLogTarget(logger: Logger | undefined): void {
  diagLogTarget = logger;
}

export function getDiagLogTarget(): Logger | undefined {
  return diagLogTarget;
}

/**
 * Memoize an instrument on first use. Instruments must not be created at
 * module scope: the metrics API has no late-binding proxy (unlike tracers),
 * so an instrument created before the SDK registers its global MeterProvider
 * stays a no-op forever. First *record* always happens after `buildKernel`
 * starts accepting work — well past SDK start — so first-use creation is
 * always correctly bound. (Tests that register their own provider get the
 * same guarantee by registering before exercising the seam.)
 */
export function lazy<T>(factory: () => T): () => T {
  let value: T | undefined;
  return () => (value ??= factory());
}

/**
 * Start a duration timer; the returned thunk yields elapsed SECONDS — the
 * unit every duration instrument here records ('s') — so the seconds
 * conversion is named once instead of a `/ 1000` scattered per seam.
 */
export function startTimer(): () => number {
  const started = performance.now();
  return () => (performance.now() - started) / 1000;
}
