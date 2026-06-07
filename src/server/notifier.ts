import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";

import { ATTR_MCP_PAPRIKA_TRANSPORT } from "../telemetry/instruments.js";
import { getMeter, lazy } from "../telemetry/scope.js";

/**
 * Logging message parameters as accepted by McpServer.sendLoggingMessage.
 */
export type LoggingMessageParams = LoggingMessageNotification["params"];

// Both notifier implementations swallow transport failures BY CONTRACT (the
// kernel's never-throws syncOnce depends on it), which makes this counter the
// only signal a session is wedged: the swallowed branches record outcome
// "failed" where the logs say nothing. Recording happens inside the swallow
// and must itself never throw — OTel API calls don't, by design.
const notifications = lazy(() =>
  getMeter().createCounter("mcp_paprika.notifications", {
    description: "MCP notifications pushed to clients, by type, transport, and outcome",
    unit: "{notification}",
  }),
);

function countNotification(type: string, transport: string, outcome: "sent" | "failed" | "dropped"): void {
  notifications().add(1, {
    "mcp_paprika.notification.type": type,
    [ATTR_MCP_PAPRIKA_TRANSPORT]: transport,
    "mcp_paprika.notification.outcome": outcome,
  });
}

/**
 * Abstraction over MCP server notifications. Decouples mutation callers
 * from "the server" so the same business logic works whether there is one
 * server (stdio) or many (HTTP sessions).
 */
export interface Notifier {
  /** Tell connected clients to re-fetch the resource list. Fire-and-forget. */
  resourceListChanged(): void;

  /** Push a logging message to connected clients. Resolves after best-effort delivery. */
  loggingMessage(params: LoggingMessageParams): Promise<void>;
}

/**
 * A mutable holder for the one McpServer, assigned once after it is built.
 *
 * Breaks the stdio bootstrap cycle without a closure-over-a-`let`: the
 * AppContext needs a notifier, the notifier needs the server, and the server is
 * built from the AppContext. A `ServerRef` is created first, its `get` handed to
 * {@link singleServerNotifier}, and `set` called once the server exists. Until
 * then `get()` returns `undefined` and notifications no-op — safe because
 * nothing notifies before the server connects.
 */
export interface ServerRef {
  get(): McpServer | undefined;
  set(server: McpServer): void;
}

export function createServerRef(): ServerRef {
  let server: McpServer | undefined;
  return {
    get: () => server,
    set: (s) => {
      server = s;
    },
  };
}

/**
 * Notifier backed by a single McpServer (stdio mode).
 *
 * Accepts either an `McpServer` directly, or a getter that returns one. The
 * getter form solves a chicken-and-egg in the stdio entry point: the
 * AppContext must be built (with a notifier) *before* the McpServer can be
 * built (because the server needs the AppContext for handler registration).
 * Notifier methods are only invoked at runtime, well after the server
 * exists, so the deferred lookup is safe.
 *
 * If the getter returns `undefined`, notifications are silently dropped —
 * matches the existing "swallow logging errors when not connected" behavior.
 */
export function singleServerNotifier(serverOrGetter: McpServer | (() => McpServer | undefined)): Notifier {
  const getServer = typeof serverOrGetter === "function" ? serverOrGetter : () => serverOrGetter;
  return {
    resourceListChanged() {
      const server = getServer();
      if (!server) {
        countNotification("resource_list_changed", "stdio", "dropped");
        return;
      }
      try {
        server.sendResourceListChanged();
        countNotification("resource_list_changed", "stdio", "sent");
      } catch {
        // Swallow errors so a notification failure cannot break the sync loop.
        countNotification("resource_list_changed", "stdio", "failed");
      }
    },
    async loggingMessage(params) {
      const server = getServer();
      if (!server) {
        countNotification("logging_message", "stdio", "dropped");
        return;
      }
      try {
        await server.sendLoggingMessage(params);
        countNotification("logging_message", "stdio", "sent");
      } catch {
        // Logging may throw if not connected — swallow silently to preserve
        // SyncEngine's "never throws" contract.
        countNotification("logging_message", "stdio", "failed");
      }
    },
  };
}

/**
 * Snapshot view of the live sessions map, used by the broadcast notifier.
 * Callers (the HTTP transport) supply a function that returns the current
 * set of servers; the notifier iterates a snapshot to avoid mutation hazards
 * during async fan-out.
 */
export type SessionSnapshot = () => Iterable<McpServer>;

/**
 * Notifier that fans a single notification out to every live session.
 *
 * The snapshot function is invoked at notification time and the result is
 * materialized into an array before iteration, so adding or removing a
 * session mid-broadcast (especially during async `loggingMessage`) does not
 * cause iterator invalidation.
 */
export function broadcastNotifier(snapshot: SessionSnapshot): Notifier {
  return {
    resourceListChanged() {
      const servers = [...snapshot()];
      for (const server of servers) {
        try {
          server.sendResourceListChanged();
          countNotification("resource_list_changed", "http", "sent");
        } catch {
          // Per-session failure must not stop the broadcast.
          countNotification("resource_list_changed", "http", "failed");
        }
      }
    },
    async loggingMessage(params) {
      const servers = [...snapshot()];
      // Each call is wrapped in an async IIFE so a synchronous throw from
      // server.sendLoggingMessage() (not just a rejected promise) becomes a
      // rejected promise inside the IIFE, which Promise.allSettled can then
      // absorb. Without this, a sync throw escapes the `map(...)` callback
      // before Promise.allSettled is constructed and bubbles into
      // SyncEngine.syncOnce(), causing it to wrongly report a sync failure.
      const settled = await Promise.allSettled(
        servers.map(async (server) => {
          await server.sendLoggingMessage(params);
        }),
      );
      for (const result of settled) {
        countNotification("logging_message", "http", result.status === "fulfilled" ? "sent" : "failed");
      }
    },
  };
}
