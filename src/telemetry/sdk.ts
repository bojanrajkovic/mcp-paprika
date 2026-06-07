// pattern: Imperative Shell — the foreign-boundary wrapper around the OTel NodeSDK.
//
// Loaded ONLY when `telemetryEnabled` says so (the bootstrap dynamic-imports
// this module), so a non-observing process never parses the SDK. Everything
// here that can throw is foreign (the SDK, `node:fs`, `node:module`) and is
// caught at this edge into a `Result` (ADR-0014); telemetry failing to start
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
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";
import { Result } from "neverthrow";
import { z } from "zod";

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
 * instrumentation Just Works wherever `--import` is used. See ADR-0018.
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
      const sdk = new NodeSDK({
        resource: resourceFromAttributes({
          [ATTR_SERVICE_NAME]: process.env["OTEL_SERVICE_NAME"] ?? "mcp-paprika",
          ...(version !== undefined && { [ATTR_SERVICE_VERSION]: version }),
        }),
        resourceDetectors: [envDetector, processDetector, hostDetector, osDetector, containerDetector],
        traceExporter: new OTLPTraceExporter(),
        metricReaders: [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter(),
            // The reader does not read OTEL_METRIC_EXPORT_INTERVAL itself
            // (verified against sdk-metrics 2.7); honor it here so operators
            // keep the standard knob. Milliseconds, default 60s.
            exportIntervalMillis: Number(process.env["OTEL_METRIC_EXPORT_INTERVAL"] ?? "") || 60_000,
          }),
        ],
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
