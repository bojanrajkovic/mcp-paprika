// The foreign-boundary wrapper around the OTel NodeSDK.
//
// Loaded ONLY when `telemetryEnabled` says so (the bootstrap dynamic-imports
// this module), so a non-observing process never parses the SDK. Everything
// here that can throw is foreign (the SDK, `node:fs`, `node:module`) and is
// caught at this edge into a `Result`; telemetry failing to start
// must never take the server down.
//
// Wire-safety invariant (stdio): nothing in the export path may touch stdout.
// Exporters are OTLP-over-HTTP only, and the diag logger below writes to
// stderr. The NodeSDK would otherwise install a `DiagConsoleLogger` when
// `OTEL_LOG_LEVEL` is set — whose info/debug/verbose levels write to STDOUT,
// the MCP wire — so `startTelemetry` consumes and clears that env var before
// constructing the SDK and installs the stderr logger itself.

import { readFileSync } from "node:fs";
import { register } from "node:module";
import { join } from "node:path";

import { diag, type DiagLogger, DiagLogLevel } from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { RuntimeNodeInstrumentation } from "@opentelemetry/instrumentation-runtime-node";
import { UndiciInstrumentation } from "@opentelemetry/instrumentation-undici";
import { containerDetector } from "@opentelemetry/resource-detector-container";
import {
  envDetector,
  hostDetector,
  osDetector,
  processDetector,
  resourceFromAttributes,
} from "@opentelemetry/resources";
import {
  type AggregationOption,
  AggregationType,
  InstrumentType,
  PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { Result } from "neverthrow";
import { z } from "zod";

import { urlScrubbingExporter } from "./url-scrub.js";

const DIAG_LEVELS: Readonly<Record<string, DiagLogLevel>> = {
  none: DiagLogLevel.NONE,
  error: DiagLogLevel.ERROR,
  warn: DiagLogLevel.WARN,
  info: DiagLogLevel.INFO,
  debug: DiagLogLevel.DEBUG,
  verbose: DiagLogLevel.VERBOSE,
  all: DiagLogLevel.ALL,
};

// process.stderr.write is deliberate: diag fires inside the SDK's export loop,
// before/after the structured logger's lifetime, and must never touch stdout
// (the stdio MCP wire). Same documented-exception class as src/index.ts; see
// src/telemetry/CLAUDE.md.
function stderrDiagLogger(): DiagLogger {
  const at =
    (level: string) =>
    (message: string, ...args: ReadonlyArray<unknown>): void => {
      const detail = args.length > 0 ? ` ${args.map(String).join(" ")}` : "";
      process.stderr.write(`[otel:${level}] ${message}${detail}\n`);
    };
  return { error: at("error"), warn: at("warn"), info: at("info"), debug: at("debug"), verbose: at("verbose") };
}

const packageJsonSchema = z.object({ version: z.string() });

/** Parse a standard millisecond knob; anything non-finite or non-positive takes the fallback (no falsy-zero trap). */
function positiveMillis(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Whether a signal should export. The bootstrap gate is endpoint-wide (any
 * OTLP endpoint enables telemetry); per signal, export needs that signal's
 * endpoint (general or signal-specific) AND no standard
 * `OTEL_{TRACES,METRICS}_EXPORTER=none` opt-out. Without this, an operator
 * setting only OTEL_EXPORTER_OTLP_METRICS_ENDPOINT would get a trace exporter
 * pointed at its localhost default, failing every export.
 */
function otlpSignalEnabled(signal: "TRACES" | "METRICS"): boolean {
  if (process.env[`OTEL_${signal}_EXPORTER`]?.toLowerCase() === "none") return false;
  const general = process.env["OTEL_EXPORTER_OTLP_ENDPOINT"];
  const specific = process.env[`OTEL_EXPORTER_OTLP_${signal}_ENDPOINT`];
  return (general !== undefined && general !== "") || (specific !== undefined && specific !== "");
}

// Every histogram exports as a base2 EXPONENTIAL histogram (Prometheus/Mimir
// "native histograms"): automatic bucketing at better resolution than any
// hand-picked boundary set, which is why the semconv specs' advisory explicit
// buckets are deliberately NOT used here. Requires a native-histogram-capable
// pipeline (the LGTM stack qualifies); see docs/telemetry.md.
const exponentialHistograms = (instrumentType: InstrumentType): AggregationOption =>
  instrumentType === InstrumentType.HISTOGRAM
    ? { type: AggregationType.EXPONENTIAL_HISTOGRAM }
    : { type: AggregationType.DEFAULT };

// dist/telemetry/sdk.js → ../../package.json lands on the repo/install root;
// the same hop works from src/ under tsx. A missing/unreadable package.json
// degrades to an unversioned resource, never a startup failure.
function serviceVersion(): string | undefined {
  return Result.fromThrowable(
    () => {
      const raw = readFileSync(join(import.meta.dirname, "..", "..", "package.json"), "utf8");
      return packageJsonSchema.parse(JSON.parse(raw)).version;
    },
    () => undefined,
  )().match(
    (version) => version,
    () => undefined,
  );
}

/**
 * Register the OTel ESM loader hook, build the NodeSDK, and start it.
 * Returns the shutdown thunk (flush + stop) on success. The loader hook only
 * has effect when this module loads via the `--import` preload path (the
 * container CMD); under the first-import fallback the main graph is already
 * linked and registration is harmless — none of the configured
 * instrumentations need it (undici and runtime-node are diagnostics_channel/
 * perf-hooks based). It exists for headroom: any future module-patching
 * instrumentation Just Works wherever `--import` is used.
 */
export function startTelemetry(): Result<() => Promise<void>, Error> {
  return Result.fromThrowable(
    () => {
      register("@opentelemetry/instrumentation/hook.mjs", import.meta.url);

      // Consume OTEL_LOG_LEVEL ourselves (stderr logger, default ERROR so a
      // dead collector is visible without being chatty), and clear it so the
      // NodeSDK constructor can't install its stdout-writing console logger.
      const rawLevel = process.env["OTEL_LOG_LEVEL"];
      delete process.env["OTEL_LOG_LEVEL"];
      diag.setLogger(stderrDiagLogger(), DIAG_LEVELS[rawLevel?.toLowerCase() ?? ""] ?? DiagLogLevel.ERROR);

      const version = serviceVersion();
      // The reader does not read OTEL_METRIC_EXPORT_INTERVAL / _TIMEOUT itself
      // (verified against sdk-metrics 2.7); honor both here so operators keep
      // the standard knobs. The timeout self-clamps to the interval: passing
      // both explicitly puts the reader on its throwing validation branch,
      // and a timeout longer than the interval is invalid by construction.
      const exportIntervalMillis = positiveMillis(process.env["OTEL_METRIC_EXPORT_INTERVAL"], 60_000);
      const exportTimeoutMillis = Math.min(
        positiveMillis(process.env["OTEL_METRIC_EXPORT_TIMEOUT"], 30_000),
        exportIntervalMillis,
      );
      const sdk = new NodeSDK({
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: process.env["OTEL_SERVICE_NAME"] ?? "mcp-paprika",
          ...(version !== undefined && { [ATTR_SERVICE_VERSION]: version }),
        }),
        // Default detector set adds the container detector (not selectable
        // via NodeSDK's env list). When the operator sets the standard
        // OTEL_NODE_RESOURCE_DETECTORS, omit the option so NodeSDK's own env
        // parsing governs — including `none`, the metadata opt-out — instead
        // of this list silently overriding it.
        ...(process.env["OTEL_NODE_RESOURCE_DETECTORS"] === undefined && {
          resourceDetectors: [envDetector, processDetector, hostDetector, osDetector, containerDetector],
        }),
        // Per-signal gating (see otlpSignalEnabled); both off yields an inert
        // SDK, which the endpoint-wide bootstrap gate makes a non-case in
        // practice. Each disabled arm must pass an EXPLICIT empty array:
        // merely omitting traceExporter/metricReaders sends the NodeSDK to
        // its env auto-configuration, which defaults each signal to an otlp
        // exporter (the localhost-default failure this gate exists to
        // prevent) and even accepts `console` exporters — stdout writers,
        // i.e. the stdio MCP wire. With one arm always provided per signal,
        // that env path is unreachable in every configuration.
        ...(otlpSignalEnabled("TRACES")
          ? { traceExporter: urlScrubbingExporter(new OTLPTraceExporter()) }
          : { spanProcessors: [] }),
        // Logs are NEVER exported via OTLP (pino is the logging pipeline —
        // docs/telemetry.md); the explicit empty array keeps NodeSDK off its
        // logs env auto-configuration, whose OTEL_LOGS_EXPORTER accepts
        // `console` — a stdout writer, the stdio MCP wire — and defaults to
        // otlp at the localhost default.
        logRecordProcessors: [],
        ...(otlpSignalEnabled("METRICS")
          ? {
              metricReaders: [
                new PeriodicExportingMetricReader({
                  exporter: new OTLPMetricExporter({ aggregationPreference: exponentialHistograms }),
                  exportIntervalMillis,
                  exportTimeoutMillis,
                }),
              ],
            }
          : { metricReaders: [] }),
        instrumentations: [new UndiciInstrumentation(), new RuntimeNodeInstrumentation()],
      });
      sdk.start();
      return async (): Promise<void> => {
        await sdk.shutdown();
      };
    },
    (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  )();
}
