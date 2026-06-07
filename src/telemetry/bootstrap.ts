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

/**
 * Flush and stop the SDK; a no-op when telemetry never started, and latched
 * so competing shutdown paths (the stdio EOF handler racing a signal) flush
 * exactly once. Called AFTER the transport closes, so session-duration
 * metrics recorded at session close make the final export. Shutdown errors
 * are swallowed onto stderr — a failed flush must not flip the exit code.
 */
export async function shutdownTelemetry(): Promise<void> {
  if (shutdown === undefined) return;
  const stop = shutdown;
  shutdown = undefined;
  await stop().catch((error: unknown) => {
    process.stderr.write(`[mcp-paprika] OpenTelemetry shutdown error: ${String(error)}\n`);
  });
}
