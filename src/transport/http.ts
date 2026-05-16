import { randomUUID } from "node:crypto";
import type { Server as NodeHttpServer } from "node:http";

import { StreamableHTTPTransport } from "@hono/mcp";
import { serve, type ServerType } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";

import { buildAppContext, buildMcpServer } from "../server/build.js";
import { broadcastNotifier } from "../server/notifier.js";
import type { PaprikaConfig } from "../utils/config.js";
import type { TransportHandle } from "./stdio.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;
const MCP_SESSION_HEADER = "mcp-session-id";

/**
 * Handle returned by `startHttp`. Extends `TransportHandle` with the
 * port the HTTP server actually bound to (useful for tests that pass
 * `port: 0` to bind an ephemeral port).
 */
export interface HttpTransportHandle extends TransportHandle {
  readonly port: number;
}

function log(msg: string): void {
  process.stderr.write(`[mcp-paprika] ${msg}\n`);
}

interface Session {
  server: McpServer;
  transport: StreamableHTTPTransport;
}

/**
 * Start the server as a Streamable HTTP endpoint. Returns a handle whose
 * `shutdown()` aborts open SSE streams, evicts all sessions, drains the
 * HTTP server, and stops the sync engine — all under a hard timeout.
 *
 * Session model: one `McpServer` + `StreamableHTTPTransport` pair per
 * client, kept in a `Map<sessionId, Session>`. Shared `AppContext` (auth,
 * caches, stores, vector index) is built once at startup; the `notifier` is
 * a `broadcastNotifier` that fans every notification across all live
 * sessions so a mutation made by client A propagates to clients B and C.
 *
 * Routes:
 * - `GET /healthz` — liveness probe; returns `{ ok: true, sessions: N }`.
 * - `ALL /mcp` — JSON-RPC entry. Initialize creates a new session; subsequent
 *   requests look up the session via the `mcp-session-id` header. Stale
 *   session ids return 404; non-initialize requests without a session id
 *   return 400.
 */
export async function startHttp(config: PaprikaConfig): Promise<HttpTransportHandle> {
  const sessions = new Map<string, Session>();
  // The snapshot getter is invoked at notification time. Materializing the
  // current set of servers here avoids iterator invalidation during async
  // fan-out (e.g. broadcasting a logging message while a session is being
  // evicted by an unrelated DELETE).
  const notifier = broadcastNotifier(() => [...sessions.values()].map((s) => s.server));

  const { app, sync } = await buildAppContext(config, notifier);

  log("Running initial sync...");
  await sync.syncOnce();
  log("Initial sync complete.");

  if (config.sync.enabled) {
    sync.start();
    log(`Sync engine started (interval: ${config.sync.interval.toString()}ms).`);
  } else {
    log("Background sync disabled.");
  }

  const hono = new Hono();

  hono.get("/healthz", (c) =>
    c.json({
      ok: true,
      sessions: sessions.size,
    }),
  );

  hono.all("/mcp", async (c) => {
    const sessionId = c.req.header(MCP_SESSION_HEADER);

    if (sessionId !== undefined) {
      const session = sessions.get(sessionId);
      if (!session) {
        return c.json({ error: "Unknown session id" }, 404);
      }
      const response = await session.transport.handleRequest(c);
      return response ?? c.body(null, 204);
    }

    // No session id: this MUST be an initialize request. We pre-parse the
    // JSON body here only on this branch (the with-session-id branch
    // delegates straight to the transport, which parses the body once
    // internally). `parsedBody` is passed back into `handleRequest` so the
    // transport doesn't re-read the request stream.
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Invalid JSON body" }, 400);
    }

    if (!isInitializeRequest(body)) {
      return c.json(
        {
          error: "First request without a session id must be an initialize request",
        },
        400,
      );
    }

    const server = buildMcpServer(app);
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport });
      },
      onsessionclosed: (id) => {
        sessions.delete(id);
      },
    });

    await server.connect(transport);
    const response = await transport.handleRequest(c, body);
    return response ?? c.body(null, 204);
  });

  const { httpServer, port: boundPort } = await new Promise<{ httpServer: ServerType; port: number }>((resolve) => {
    const server = serve(
      {
        fetch: hono.fetch,
        port: config.http.port,
        hostname: config.http.host,
      },
      (info) => {
        resolve({ httpServer: server, port: info.port });
      },
    );
  });

  log(`HTTP transport listening on http://${config.http.host}:${boundPort.toString()}/mcp`);
  log(`Health probe: GET http://${config.http.host}:${boundPort.toString()}/healthz`);
  log(
    `WARNING: No built-in authentication. Place a reverse proxy (Cloudflare Access, Tailscale Serve, OAuth2 proxy) in front of this server before exposing it publicly.`,
  );

  return {
    port: boundPort,
    async shutdown() {
      log("HTTP shutdown: stopping sync engine and closing sessions...");

      // Order matters. node:http's `Server.close()` waits forever for
      // long-lived SSE GET streams to finish on their own. We must abort
      // every open transport first (which terminates its SSE writer), then
      // drain the HTTP server. Wrap the whole sequence in a hard timeout
      // so a misbehaving session can't hold shutdown forever.
      const drain = async (): Promise<void> => {
        sync.stop();

        const sessionSnapshot = [...sessions.values()];
        await Promise.allSettled(sessionSnapshot.map((s) => s.transport.close()));
        sessions.clear();

        await new Promise<void>((resolve, reject) => {
          const nodeServer = httpServer as unknown as NodeHttpServer;
          nodeServer.close((err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      };

      let timedOut = false;
      const timeout = new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, SHUTDOWN_TIMEOUT_MS).unref();
      });

      await Promise.race([drain(), timeout]);

      if (timedOut) {
        process.stderr.write(
          `[mcp-paprika] Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS.toString()}ms timeout; forcing exit.\n`,
        );
        process.exit(1);
      }

      log("HTTP shutdown complete.");
    },
  };
}
