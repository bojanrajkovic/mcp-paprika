#!/usr/bin/env node
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildAppContext, buildMcpServer } from "./server/build.js";
import { singleServerNotifier } from "./server/notifier.js";
import { loadConfig } from "./utils/config.js";

function log(msg: string): void {
  process.stderr.write(`[mcp-paprika] ${msg}\n`);
}

async function main(): Promise<void> {
  log("Loading configuration...");
  const config = loadConfig().match(
    (cfg) => cfg,
    (err) => {
      throw err;
    },
  );

  // The notifier must be constructed before AppContext (which needs it for
  // SyncEngine), but the McpServer can only be built after AppContext (since
  // registerXxxTool(server, sessionCtx) needs sessionCtx). Resolve the
  // ordering with a deferred-getter notifier — methods are only called at
  // runtime, by which point `server` has been assigned.
  let server: McpServer | undefined;
  const notifier = singleServerNotifier(() => server);

  const { app, sync } = await buildAppContext(config, notifier);
  server = buildMcpServer(app);

  log("Running initial sync...");
  await sync.syncOnce();
  log("Initial sync complete.");

  if (config.sync.enabled) {
    sync.start();
    log(`Sync engine started (interval: ${config.sync.interval.toString()}ms).`);
  } else {
    log("Background sync disabled.");
  }

  process.on("SIGINT", () => {
    log("SIGINT received, shutting down...");
    sync.stop();
    process.exit(0);
  });

  log("Connecting stdio transport...");
  await server.connect(new StdioServerTransport());
  log("Server ready.");
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
