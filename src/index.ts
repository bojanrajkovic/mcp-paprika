#!/usr/bin/env node
// Telemetry bootstrap MUST stay the first import: sibling static imports
// evaluate in declaration order, and the SDK has to start before any other
// module evaluates. (Under the container's `--import` preload this resolves
// to the already-evaluated cache — see src/telemetry/bootstrap.ts.)
import { shutdownTelemetry } from "./telemetry/bootstrap.js";
import { startHttp } from "./transport/http.js";
import { startStdio, type TransportHandle } from "./transport/stdio.js";
import { loadConfig } from "./utils/config.js";
import { toMessage } from "./utils/log.js";

async function main(): Promise<void> {
  const config = loadConfig().match(
    (cfg) => cfg,
    (err) => {
      throw err;
    },
  );

  const handle: TransportHandle = config.transport === "http" ? await startHttp(config) : await startStdio(config);

  let shuttingDown = false;
  const onSignal = (signal: string) => {
    // Re-entry guard: k8s sends one SIGTERM, but a user may Ctrl-C twice (or a
    // SIGINT can follow a SIGTERM). A second shutdown() would call
    // nodeServer.close() on an already-closing server and reject. Ignore
    // repeats — the first shutdown owns the exit.
    if (shuttingDown) {
      process.stderr.write(`${signal} received during shutdown; ignoring.\n`);
      return;
    }
    shuttingDown = true;
    // process.stderr.write is used here intentionally — the structured logger may not
    // be built yet (early startup failure) or may already be torn down at signal time.
    // See src/server/CLAUDE.md for the documented exception.
    process.stderr.write(`${signal} received, shutting down...\n`);
    // Telemetry flushes after the transport closes, so session-close metrics
    // make the final export; shutdownTelemetry never rejects.
    handle
      .shutdown()
      .then(() => shutdownTelemetry())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          process.stderr.write(`[mcp-paprika] Shutdown error: ${toMessage(err)}\n`);
          process.exit(1);
        },
      );
  };

  process.on("SIGINT", () => {
    onSignal("SIGINT");
  });
  process.on("SIGTERM", () => {
    onSignal("SIGTERM");
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`${toMessage(err)}\n`);
  process.exit(1);
});
