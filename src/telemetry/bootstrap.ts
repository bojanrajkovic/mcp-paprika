// The telemetry entry point, loaded two ways.
//
// 1. Container / HTTP deployments: `node --import dist/telemetry/bootstrap.js
//    dist/index.js` (the Dockerfile CMD). The preload graph fully evaluates —
//    including the top-level-await SDK start below — BEFORE the entry module's
//    graph is even resolved, so the ESM loader hook registered in sdk.ts can
//    transform application modules.
// 2. stdio / npm-bin: `src/index.ts` declares this module as its FIRST static
//    import. An npm bin script cannot carry node flags, and ESM links the whole
//    static graph before evaluating, so the loader hook is inert here — which
//    is fine: every configured instrumentation is diagnostics_channel- or
//    perf-hooks-based and needs no module patching (ADR-0018).
//
// ESM module caching makes the two paths idempotent: whichever loads first
// evaluates; the other resolves to the cached instance.

import { join } from "node:path";

import dotenv from "dotenv";

import { getConfigDir } from "../utils/xdg.js";
import { telemetryEnabled } from "./enabled.js";

// The SDK and the gate read OTEL_* at construction time, which races
// loadConfig()'s own dotenv pass — so load the SAME XDG-config .env here
// first. dotenv never overrides already-set vars, making the second pass in
// loadConfig a no-op for these keys. quiet: true for the stdio wire (#49).
dotenv.config({ path: join(getConfigDir(), ".env"), quiet: true });

let shutdown: (() => Promise<void>) | undefined;

if (telemetryEnabled(process.env)) {
  // Dynamic import keeps the entire SDK out of the module graph when
  // telemetry is off — a stdio process spawned per client session shouldn't
  // parse ~30 packages it won't use.
  const { startTelemetry } = await import("./sdk.js");
  startTelemetry().match(
    (stop) => {
      shutdown = stop;
    },
    (error) => {
      // Pre-logger boot path; stderr is the only safe channel (stdout is the
      // stdio MCP wire). Telemetry failing to start is a warning, never fatal.
      process.stderr.write(
        `[mcp-paprika] OpenTelemetry startup failed; continuing without telemetry: ${error.message}\n`,
      );
    },
  );
}

let shutdownInFlight: Promise<void> | undefined;

// Upper bound on the shutdown flush. Against an unreachable collector,
// `sdk.shutdown()` waits out the metric reader's export timeout — 30s by
// default, the WHOLE terminationGracePeriodSeconds in k8s/30-deployment.yaml,
// and the HTTP shutdown path has already spent up to ~15s draining and
// closing before telemetry runs. A healthy collector flushes in well under a
// second; past this bound the flush is abandoned (stderr-noted) so a dead
// collector can never hold process termination into the SIGKILL.
const SHUTDOWN_FLUSH_TIMEOUT_MS = 5_000;

/**
 * Flush and stop the SDK; a no-op when telemetry never started. Competing
 * shutdown paths (the stdio EOF handler racing a signal, stdin `end` and
 * `close` both firing) all AWAIT THE SAME in-flight flush — a latch that
 * merely no-ops the second caller would let it process.exit() mid-flush and
 * drop the buffered spans the first caller was still exporting. Called AFTER
 * the transport closes, so session-duration metrics recorded at session
 * close make the final export. Bounded by SHUTDOWN_FLUSH_TIMEOUT_MS, and
 * shutdown errors are swallowed onto stderr — a slow or failed flush must
 * not stall termination or flip the exit code.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (shutdown !== undefined) {
    const stop = shutdown;
    shutdown = undefined;
    shutdownInFlight = new Promise((resolve) => {
      // unref: the deadline must never be what keeps the process alive.
      const deadline = setTimeout(() => {
        process.stderr.write(
          `[mcp-paprika] OpenTelemetry shutdown timed out after ${String(SHUTDOWN_FLUSH_TIMEOUT_MS)}ms; abandoning flush\n`,
        );
        resolve();
      }, SHUTDOWN_FLUSH_TIMEOUT_MS).unref();
      stop()
        .catch((error: unknown) => {
          process.stderr.write(`[mcp-paprika] OpenTelemetry shutdown error: ${String(error)}\n`);
        })
        .finally(() => {
          clearTimeout(deadline);
          resolve();
        });
    });
  }
  await shutdownInFlight;
}
