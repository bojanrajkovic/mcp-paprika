#!/usr/bin/env node
import { startHttp } from "./transport/http.js";
import { startStdio, type TransportHandle } from "./transport/stdio.js";
import { loadConfig } from "./utils/config.js";
import { createLogger, toMessage } from "./utils/log.js";

const log = createLogger("mcp-paprika");

async function main(): Promise<void> {
  log("Loading configuration...");
  const config = loadConfig().match(
    (cfg) => cfg,
    (err) => {
      throw err;
    },
  );

  const handle: TransportHandle = config.transport === "http" ? await startHttp(config) : await startStdio(config);

  const onSignal = (signal: string) => {
    log(`${signal} received, shutting down...`);
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
