import { randomUUID } from "node:crypto";
import type { Server as NodeHttpServer } from "node:http";

import { StreamableHTTPTransport } from "@hono/mcp";
import { bearerAuth, mcpAuthRouter } from "@hono/mcp";
import { serve, type ServerType } from "@hono/node-server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { Logger } from "pino";

import type { PaprikaConfig } from "../utils/config.js";
import type { TransportHandle } from "./stdio.js";

import { buildAuthMetadataRouter } from "../auth/metadata.js";
import { buildAuthRoutes, buildClientCap, buildDcrRateLimit, MAX_REGISTERED_CLIENTS } from "../auth/routes.js";
import { buildAppContext, buildMcpServer } from "../server/build.js";
import { broadcastNotifier } from "../server/notifier.js";

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

interface Session {
  server: McpServer;
  transport: StreamableHTTPTransport;
}

/**
 * Hono middleware factory that logs one structured record per request.
 *
 * Emits `info` for all 2xx/3xx/4xx responses and `error` for 5xx. The record
 * carries `{method, path, status, durationMs}` so operators can correlate
 * access patterns with structured log streams without parsing text.
 *
 * Exported for isolated unit testing — `startHttp` has no logger injection
 * seam, so tests instantiate `accessLog` directly with a capture logger.
 */
const PROBE_PATHS = new Set(["/healthz"]);

export function accessLog(log: Logger) {
  return async (c: Context, next: Next): Promise<void> => {
    if (PROBE_PATHS.has(c.req.path)) {
      await next();
      return;
    }
    const t0 = performance.now();
    try {
      await next();
    } finally {
      // Log unconditionally, even if a downstream handler throws past Hono's
      // onError. Hono's default behavior converts thrown errors into 500
      // responses without re-throwing through next(), but wrapping in
      // try/finally protects against future middleware that does re-throw
      // and guarantees access-log telemetry for every request.
      const durationMs = Math.round(performance.now() - t0);
      const status = c.res.status;
      const fields = { method: c.req.method, path: c.req.path, status, durationMs };

      if (status >= 500) {
        log.error(fields, "http request 5xx");
      } else {
        log.info(fields, "http request");
      }
    }
  };
}

/**
 * Options for `startHttp`. All fields are optional and intended for testing.
 * Production callers should pass only `config`.
 */
export type StartHttpOptions = {
  /**
   * Override the transport-level pino logger. When provided, replaces
   * `app.log.child({ component: "transport-http" })` so integration tests
   * can capture access-log records without spinning up a real multistream.
   */
  readonly _testLog?: Logger;
};

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
export async function startHttp(config: PaprikaConfig, opts: StartHttpOptions = {}): Promise<HttpTransportHandle> {
  const sessions = new Map<string, Session>();

  // DNS rebinding protection: derive once at startup. The SDK's transport
  // options for allowedHosts/allowedOrigins/enableDnsRebindingProtection carry
  // @deprecated JSDoc in @modelcontextprotocol/sdk 1.29.0 (it suggests
  // external middleware) but the implementation still exists and is the
  // smallest surface for this knob. If/when the SDK removes them, swap to a
  // Hono middleware on /mcp.
  const { allowedHosts, allowedOrigins } = config.http;
  const dnsRebindingProtection = allowedHosts.length > 0 || allowedOrigins.length > 0;
  // The snapshot getter is invoked at notification time. Materializing the
  // current set of servers here avoids iterator invalidation during async
  // fan-out (e.g. broadcasting a logging message while a session is being
  // evicted by an unrelated DELETE).
  const notifier = broadcastNotifier(() => [...sessions.values()].map((s) => s.server));

  // Flipped true at the start of shutdown() so the readiness probe (/healthz)
  // begins failing and Kubernetes removes this pod from the Service endpoints
  // before we close connections. See the pre-drain delay in shutdown().
  let draining = false;

  // buildAppContext runs the initial sync internally so cold-start vector
  // indexing happens against a fully-populated RecipeStore (categories
  // included). See src/server/build.ts for the ordering rationale.
  const { app, sync } = await buildAppContext(config, notifier);

  const log = opts._testLog ?? app.log.child({ component: "transport-http" });

  if (config.sync.enabled) {
    sync.start();
    log.info({ intervalMs: config.sync.interval }, "sync engine started");
  } else {
    log.info("background sync disabled");
  }

  const hono = new Hono();

  // Access log: mounted BEFORE /healthz and /mcp so every route's responses
  // are captured — including the liveness probe. Also before the auth block
  // so 401s and all other auth-mediated responses are captured.
  hono.use("*", accessLog(log));

  hono.get("/healthz", (c) => {
    // While draining, fail readiness (503) so Kubernetes stops routing new
    // traffic here. The pod is terminating, so kubelet ignores the matching
    // liveness failure rather than restarting it.
    if (draining) {
      return c.json({ ok: false, draining: true, sessions: sessions.size }, 503);
    }
    return c.json({ ok: true, sessions: sessions.size });
  });

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
    //
    //    Disable every built-in rate limiter — @hono/mcp's defaults keyGen
    //    every endpoint to a single shared string ("some-unique-key"), so one
    //    noisy client can exhaust the global bucket for everyone (DoS). Our
    //    own per-IP DCR limiter at step 2 handles registration; /authorize,
    //    /token, and /revoke are already gated by client_id / bearer / RAT
    //    checks and don't need an additional shared-key limiter.
    hono.route(
      "/",
      mcpAuthRouter({
        provider: auth.provider,
        issuerUrl: auth.config.publicUrl,
        resourceServerUrl,
        authorizationOptions: { rateLimit: false },
        tokenOptions: { rateLimit: false },
        revocationOptions: { rateLimit: false },
        clientRegistrationOptions: { rateLimit: false },
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
        pendingAuthorizations: auth.pendingAuthorizations,
        oidcConfig: auth.config,
        discovery: auth.discovery,
        jwks: auth.jwks,
        publicUrl: auth.config.publicUrl,
        log: auth.log,
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
      allowedHosts,
      allowedOrigins,
      enableDnsRebindingProtection: dnsRebindingProtection,
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

  log.info({ url: `http://${config.http.host}:${boundPort.toString()}/mcp` }, "HTTP transport listening");
  if (app.auth !== null) {
    log.info({ issuer: app.auth.config.publicUrl }, "OAuth issuer");
    log.info({ upstream: app.auth.discovery.issuer, scopes: app.auth.config.scopes.join(" ") }, "OAuth upstream");
    log.info(
      {
        emails: app.auth.config.allowlist.emails.length,
        subs: app.auth.config.allowlist.subs.length,
      },
      "identity allowlist",
    );
    app.auth.cleanup.start();
  }
  // In production startHttp is only dispatched when MCP_TRANSPORT=http, which
  // makes buildAuthContext return a non-null AuthContext (or fail-fast). The
  // null branch is exercised only by transport tests that pass MCP_TRANSPORT=stdio
  // to skip the OAuth fixture — see src/transport/http.test.ts.
  log.info({ url: `http://${config.http.host}:${boundPort.toString()}/healthz` }, "health probe available");

  return {
    port: boundPort,
    async shutdown() {
      const nodeServer = httpServer as unknown as NodeHttpServer;

      // Phase 1 — readiness drain. Flip /healthz to 503 and keep serving for
      // config.http.shutdownDrainMs so Kubernetes de-routes this pod (endpoint
      // removal + kube-proxy/ingress propagation) before we close anything.
      // Requests already in flight or routed during the propagation window
      // still get a working server. Skipped when the delay is 0 (stdio/tests).
      draining = true;
      if (config.http.shutdownDrainMs > 0) {
        log.info({ drainMs: config.http.shutdownDrainMs }, "HTTP shutdown: readiness draining");
        await new Promise<void>((resolve) => {
          setTimeout(resolve, config.http.shutdownDrainMs);
        });
      }

      // Phase 2 — stop the sync engine and close sessions/connections.
      log.info("HTTP shutdown: stopping sync engine and closing sessions");

      // Order matters. node:http's `Server.close()` stops accepting new
      // connections but then waits for existing ones to finish on their own —
      // long-lived SSE GET streams and idle keep-alive sockets never do. We
      // abort every open transport first (terminating its SSE writer), then
      // `close()` + `closeIdleConnections()` so in-flight requests get to
      // finish while idle keep-alive sockets are released immediately. Without
      // the idle close, `close()` blocks until the timeout below — which on
      // SIGTERM means a needless 10s pause before the pod exits. The whole
      // sequence is wrapped in a hard timeout so a stuck in-flight request
      // can't hold shutdown past the k8s grace period.
      const drain = async (): Promise<void> => {
        sync.stop();
        app.auth?.cleanup.stop();

        const sessionSnapshot = [...sessions.values()];
        await Promise.allSettled(sessionSnapshot.map((s) => s.transport.close()));
        sessions.clear();

        await new Promise<void>((resolve, reject) => {
          nodeServer.close((err) => {
            if (err) reject(err);
            else resolve();
          });
          nodeServer.closeIdleConnections();
        });
      };

      let timedOut = false;
      const timeout = new Promise<void>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          resolve();
        }, SHUTDOWN_TIMEOUT_MS).unref();
      });

      // The drain promise must not surface as an unhandled rejection if the
      // timeout wins the race; swallow late errors (the process is exiting).
      await Promise.race([drain().catch(() => undefined), timeout]);

      if (timedOut) {
        // A request is still in-flight past the deadline. Force the remaining
        // sockets closed so we exit cleanly within the grace period rather than
        // being SIGKILLed; this is the abnormal path, hence the warning.
        log.warn({ timeoutMs: SHUTDOWN_TIMEOUT_MS }, "shutdown exceeded timeout; forcing open connections closed");
        nodeServer.closeAllConnections();
      }

      log.info("HTTP shutdown complete");
    },
  };
}
