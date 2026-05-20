import { randomUUID } from "node:crypto";
import { createLogger } from "../utils/log.js";
import type { Server as NodeHttpServer } from "node:http";

import { StreamableHTTPTransport } from "@hono/mcp";
import { serve, type ServerType } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";

import { mcpAuthRouter, bearerAuth } from "@hono/mcp";
import { buildAppContext, buildMcpServer } from "../server/build.js";
import { broadcastNotifier } from "../server/notifier.js";
import type { PaprikaConfig } from "../utils/config.js";
import type { TransportHandle } from "./stdio.js";
import { buildAuthMetadataRouter } from "../auth/metadata.js";
import { buildAuthRoutes, buildDcrRateLimit, buildClientCap, MAX_REGISTERED_CLIENTS } from "../auth/routes.js";

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

const log = createLogger("mcp-paprika");

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

  // buildAppContext runs the initial sync internally so cold-start vector
  // indexing happens against a fully-populated RecipeStore (categories
  // included). See src/server/build.ts for the ordering rationale.
  const { app, sync } = await buildAppContext(config, notifier);

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

  if (app.auth !== null) {
    // Capture auth to avoid null-checks inside callbacks (mirrors SyncEngine pattern)
    const auth = app.auth;
    // issuerUrl stays a string at every @hono/mcp boundary — passing a URL would trigger
    // the library's .href call and force a trailing slash, breaking exact-match against MCP_PUBLIC_URL.
    const resourceServerUrl = new URL(auth.config.publicUrl);

    // 1. Customized well-known docs MUST mount BEFORE mcpAuthRouter so Hono's
    //    first-match-wins returns our overrides instead of mcpAuthRouter's defaults
    //    (which hard-code token_endpoint_auth_methods_supported: ["client_secret_post"]).
    hono.route(
      "/",
      buildAuthMetadataRouter({
        issuerUrl: auth.config.publicUrl,
        provider: auth.provider,
        resourceServerUrl,
      }),
    );

    // 2. Rate-limit + cap middleware MUST attach BEFORE mcpAuthRouter handles POST /register
    //    (mcpAuthRouter processes it internally; middleware added after would be bypassed).
    //    The middleware-level cap is a fast-path 429; the authoritative atomic enforcement
    //    lives inside DiskClientRegistrationStore.registerClient (same MAX_REGISTERED_CLIENTS).
    hono.use("/register", buildDcrRateLimit({ trustProxy: auth.config.trustProxy }));
    hono.use("/register", buildClientCap(app.cache, MAX_REGISTERED_CLIENTS));

    // 3. mcpAuthRouter mounts DCR + authorize + token + revoke.
    //    Well-known routes are shadowed by step 1 (first-match-wins).
    hono.route(
      "/",
      mcpAuthRouter({
        provider: auth.provider,
        issuerUrl: auth.config.publicUrl,
        resourceServerUrl,
      }),
    );

    // 4. Custom routes: /oauth/callback (upstream IdP redirect), RFC 7592 PUT/DELETE /register/:id
    hono.route(
      "/",
      buildAuthRoutes({
        clientStore: auth.clientStore,
        tokenStore: auth.tokenStore,
        authRequests: auth.authRequests,
        authCodes: auth.authCodes,
        oidcConfig: auth.config,
        discovery: auth.discovery,
        jwks: auth.jwks,
        publicUrl: auth.config.publicUrl,
      }),
    );

    // 5. bearerAuth guards /mcp — all unauthenticated MCP requests are rejected with 401.
    //    verifyAccessToken throws on invalid tokens; catch and return false.
    hono.use(
      "/mcp",
      bearerAuth({
        verifyToken: async (token: string) => {
          try {
            await auth.provider.verifyAccessToken(token);
            return true;
          } catch {
            return false;
          }
        },
      }),
    );
  }

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
  if (app.auth !== null) {
    log(`OAuth issuer: ${app.auth.config.publicUrl}`);
    log(`OAuth upstream: ${app.auth.discovery.issuer} (${app.auth.config.scopes.join(" ")})`);
    log(
      `Allowlist: ${app.auth.config.allowlist.emails.length.toString()} email(s), ${app.auth.config.allowlist.subs.length.toString()} sub(s)`,
    );
    app.auth.cleanup.start();
  }
  // In production startHttp is only dispatched when MCP_TRANSPORT=http, which
  // makes buildAuthContext return a non-null AuthContext (or fail-fast). The
  // null branch is exercised only by transport tests that pass MCP_TRANSPORT=stdio
  // to skip the OAuth fixture — see src/transport/http.test.ts.
  log(`Health probe: GET http://${config.http.host}:${boundPort.toString()}/healthz`);

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
        app.auth?.cleanup.stop();

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
