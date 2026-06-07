import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import type { PaprikaConfig } from "../utils/config.js";

import { GeneratedImageStore } from "../features/generated-image-store.js";
import { buildKernel } from "../kernel/registry.js";
import { buildBrandedServer, buildInfraBase } from "../server/build.js";
import { createIndexEvents } from "../server/index-events.js";
import { createServerRef, singleServerNotifier } from "../server/notifier.js";
import { notifyFromResults, runSyncLoop } from "../server/sync-loop.js";
import { ATTR_MCP_PAPRIKA_TRANSPORT, mcpServerSessionDuration } from "../telemetry/instruments.js";
// Side-effect: every domain/feature module self-registers on import, so the kernel's
// `registeredModules()` is populated before `buildKernel` reads it.
import "../kernel/modules.generated.js";

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

  // A ServerRef breaks the chicken-and-egg between the kernel's process-wide state
  // (built with the notifier) and the McpServer (built after, then bound to the
  // notifier via the ref): the ref is created first, its getter handed to the
  // notifier, and set once the server exists. See src/server/notifier.ts.
  const serverRef = createServerRef();
  const notifier = singleServerNotifier(serverRef.get);

  // buildInfraBase authenticates the client (the #158 fast-fail) and resolves the
  // logger + cache dir; buildKernel then constructs every module and runs the initial
  // sync internally, so cold-start vector indexing happens against a populated recipe
  // store. The initial cycle's notifications no-op (serverRef is unset until below).
  const { log, client, cacheDir } = await buildInfraBase(config, notifier);
  const indexEvents = createIndexEvents(log);
  const generatedImageStore = new GeneratedImageStore();
  const kernel = await buildKernel({ client, cacheDir, notifier, log, config, indexEvents, generatedImageStore });

  const server = buildBrandedServer();
  kernel.registerAll(server);
  serverRef.set(server);

  const tlog = log.child({ component: "transport-stdio" });

  // The interval loop runs its first cycle immediately (then waits), so — combined
  // with buildKernel's initial cycle — startup syncs twice. notifyFromResults turns
  // each cycle's returned results into resourceListChanged notifications, filtered to
  // the change types with a resource surface.
  const loop = config.sync.enabled
    ? runSyncLoop(async () => {
        notifyFromResults(await kernel.syncOnce(), notifier);
      }, config.sync.interval)
    : null;
  if (loop !== null) {
    tlog.info({ intervalMs: config.sync.interval }, "sync engine started");
  } else {
    tlog.info("background sync disabled");
  }

  tlog.info("connecting stdio transport");
  const sessionStartedAt = performance.now();
  await server.connect(new StdioServerTransport());
  tlog.info("server ready");

  return {
    async shutdown() {
      loop?.stop();
      // Under stdio, one session = the process lifetime, so the session
      // duration records once at graceful shutdown (this server's answer to
      // the semconv's open stdio-session-boundary question — see
      // docs/telemetry.md). A SIGKILL loses the point, as it loses any
      // final metric.
      mcpServerSessionDuration().record((performance.now() - sessionStartedAt) / 1000, {
        [ATTR_MCP_PAPRIKA_TRANSPORT]: "stdio",
      });
    },
  };
}
