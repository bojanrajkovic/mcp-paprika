import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildAppContext, buildMcpServer } from "../server/build.js";
import { createServerRef, singleServerNotifier } from "../server/notifier.js";
import type { PaprikaConfig } from "../utils/config.js";

export interface TransportHandle {
  shutdown(): Promise<void>;
}

/**
 * Emit a one-line warning if the user set HTTP env vars while transport is
 * stdio. The HTTP config block is always populated (defaults), so we
 * detect "user-set" by inspecting env vars directly. Catches the typo case
 * where someone sets `MCP_HTTP_PORT=8080` and forgets `MCP_TRANSPORT=http`.
 */
function warnIfUnusedHttpConfig(env: NodeJS.ProcessEnv): void {
  const set: string[] = [];
  if (env["MCP_HTTP_PORT"] !== undefined) set.push("MCP_HTTP_PORT");
  if (env["MCP_HTTP_HOST"] !== undefined) set.push("MCP_HTTP_HOST");
  if (set.length > 0) {
    process.stderr.write(
      `[mcp-paprika] WARNING: ${set.join(", ")} set but MCP_TRANSPORT=stdio (default); HTTP config ignored. ` +
        `Set MCP_TRANSPORT=http to use Streamable HTTP.\n`,
    );
  }
}

/**
 * Start the server with a single stdio session. Returns a handle whose
 * `shutdown()` stops the background sync engine; the stdio transport itself
 * does not need to be torn down (the process exits when stdin closes).
 */
export async function startStdio(config: PaprikaConfig): Promise<TransportHandle> {
  warnIfUnusedHttpConfig(process.env);

  // A ServerRef breaks the chicken-and-egg between AppContext (needs the
  // notifier) and McpServer (built from AppContext, then bound to the notifier):
  // the ref is created first, its getter handed to the notifier, and set once
  // the server exists. See src/server/notifier.ts for the rationale.
  const serverRef = createServerRef();
  const notifier = singleServerNotifier(serverRef.get);

  // buildAppContext runs the initial sync internally so cold-start vector
  // indexing happens against a fully-populated RecipeStore (categories
  // included). See src/server/build.ts for the ordering rationale.
  const { app, sync } = await buildAppContext(config, notifier);
  const server = buildMcpServer(app);
  serverRef.set(server);

  const log = app.log.child({ component: "transport-stdio" });

  if (config.sync.enabled) {
    sync.start();
    log.info({ intervalMs: config.sync.interval }, "sync engine started");
  } else {
    log.info("background sync disabled");
  }

  log.info("connecting stdio transport");
  await server.connect(new StdioServerTransport());
  log.info("server ready");

  return {
    async shutdown() {
      sync.stop();
    },
  };
}
