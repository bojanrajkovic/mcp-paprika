import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import type { PaprikaConfig } from "../utils/config.js";

import { GeneratedImageStore } from "../features/generated-image-store.js";
import { buildKernel } from "../kernel/registry.js";
import { buildBrandedServer, buildInfraBase } from "../server/build.js";
import { createIndexEvents } from "../server/index-events.js";
import { createServerRef, singleServerNotifier } from "../server/notifier.js";
import { notifyFromResults, runSyncLoop } from "../server/sync-loop.js";
import { shutdownTelemetry } from "../telemetry/bootstrap.js";
import { clientAttrs, clientFingerprint, recordClientConnection } from "../telemetry/client-fingerprint.js";
import { ATTR_MCP_PAPRIKA_TRANSPORT, mcpServerSessionDuration } from "../telemetry/instruments.js";
import { startTimer } from "../telemetry/scope.js";
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

  // Capture the connection fingerprint at the handshake — the stdio complement to
  // the HTTP transport's oninitialized seam (clientInfo + capability tree + the
  // connect span/counter/log + the per-server stash the tool wrapper reads). stdio
  // sees the requested protocol version only on the wire: the server retains no
  // negotiated value and there is no pre-parsed initialize body here, so sniff it
  // off the transport's message stream. The wrap goes on AFTER connect (which
  // installs the Protocol's onmessage) and delegates to it; the initialize REQUEST
  // arrives before the initialized NOTIFICATION that fires oninitialized, so the
  // captured value is ready by then.
  let requestedProtocolVersion: string | undefined;
  server.server.oninitialized = () => {
    const fp = recordClientConnection(server.server, {
      transport: "stdio",
      protocolVersion: requestedProtocolVersion,
    });
    tlog.info({ client: fp }, "mcp client connected");
  };
  const sessionElapsedSeconds = startTimer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  const deliver = transport.onmessage;
  transport.onmessage = (message) => {
    if (isInitializeRequest(message)) requestedProtocolVersion = message.params.protocolVersion;
    deliver?.(message);
  };
  tlog.info("server ready");

  // The single end-of-session point, latched: the stdin-EOF handler below and
  // the signal-driven handle.shutdown() can both reach it, and the session
  // must record exactly once. Under stdio, one session = the process
  // lifetime (this server's answer to the semconv's open stdio-session-
  // boundary question — see docs/telemetry.md); a SIGKILL loses the point,
  // as it loses any final metric.
  let sessionEnded = false;
  const endSession = (): void => {
    if (sessionEnded) return;
    sessionEnded = true;
    loop?.stop();
    const elapsedSeconds = sessionElapsedSeconds();
    const fp = clientFingerprint(server.server);
    // Label the session lifetime with the connecting client (census slice), the
    // same slice the connect span/counter carry.
    mcpServerSessionDuration().record(elapsedSeconds, {
      [ATTR_MCP_PAPRIKA_TRANSPORT]: "stdio",
      ...clientAttrs(server.server),
    });
    tlog.info(
      { client: fp?.name ?? "unknown", clientVersion: fp?.version, durationSec: Math.round(elapsedSeconds) },
      "mcp client disconnected",
    );
  };

  // A normal client disconnect is the pipe closing, not a signal — and
  // StdioServerTransport doesn't watch for it (its onclose fires only on
  // programmatic close), so without this handler an EOF leaves the sync-loop
  // and telemetry timers holding the process open forever, with no session
  // metric and no flush. This implements the lifecycle the comment above
  // documents: the process exits when stdin closes.
  const onStdinClosed = (): void => {
    tlog.info("stdin closed; shutting down");
    endSession();
    void shutdownTelemetry().then(() => process.exit(0));
  };
  process.stdin.once("end", onStdinClosed);
  process.stdin.once("close", onStdinClosed);
  // TOCTOU guard: if the client vanished during the kernel build / initial
  // sync, the pipe's end/close fired before these listeners attached and
  // nothing re-delivers them — observe the terminal state directly instead.
  // The endSession/shutdownTelemetry latches make a doubled signal harmless.
  if (process.stdin.readableEnded || process.stdin.destroyed) onStdinClosed();

  return {
    async shutdown() {
      endSession();
    },
  };
}
