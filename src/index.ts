#!/usr/bin/env node
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

  const onSignal = (signal: string) => {
    // process.stderr.write is used here intentionally — the structured logger may not
    // be built yet (early startup failure) or may already be torn down at signal time.
    // See src/server/CLAUDE.md for the documented exception.
    process.stderr.write(`${signal} received, shutting down...\n`);
    handle.shutdown().then(
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
