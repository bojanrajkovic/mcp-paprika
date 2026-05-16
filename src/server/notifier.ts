import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { LoggingMessageNotification } from "@modelcontextprotocol/sdk/types.js";

/**
 * Logging message parameters as accepted by McpServer.sendLoggingMessage.
 */
export type LoggingMessageParams = LoggingMessageNotification["params"];

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
      if (!server) return;
      try {
        server.sendResourceListChanged();
      } catch {
        // Swallow errors so a notification failure cannot break the sync loop.
      }
    },
    async loggingMessage(params) {
      const server = getServer();
      if (!server) return;
      try {
        await server.sendLoggingMessage(params);
      } catch {
        // Logging may throw if not connected — swallow silently to preserve
        // SyncEngine's "never throws" contract.
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
        } catch {
          // Per-session failure must not stop the broadcast.
        }
      }
    },
    async loggingMessage(params) {
      const servers = [...snapshot()];
      await Promise.allSettled(servers.map((server) => server.sendLoggingMessage(params)));
    },
  };
}
