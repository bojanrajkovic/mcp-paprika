import { randomUUID } from "node:crypto";
import type { Server as NodeHttpServer, ServerResponse } from "node:http";

import { StreamableHTTPTransport } from "@hono/mcp";
import { bearerAuth, mcpAuthRouter } from "@hono/mcp";
import { serve, type ServerType } from "@hono/node-server";
import { httpInstrumentationMiddleware } from "@hono/otel";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { context, trace } from "@opentelemetry/api";
import { Hono } from "hono";
import type { Context, MiddlewareHandler, Next } from "hono";
import { routePath } from "hono/route";
import type { Logger } from "pino";

import type { PaprikaConfig } from "../utils/config.js";
import type { TransportHandle } from "./stdio.js";

import { buildAuthContext } from "../auth/build.js";
import { buildAuthCaches } from "../auth/disk.js";
import { buildAuthMetadataRouter } from "../auth/metadata.js";
import { buildAuthRoutes, buildClientCap, buildDcrRateLimit, MAX_REGISTERED_CLIENTS } from "../auth/routes.js";
import { GeneratedImageStore } from "../features/generated-image-store.js";
import { buildKernel } from "../kernel/registry.js";
import { buildBrandedServer, buildInfraBase } from "../server/build.js";
import { createIndexEvents } from "../server/index-events.js";
import { broadcastNotifier } from "../server/notifier.js";
import { notifyFromResults, runSyncLoop } from "../server/sync-loop.js";
import {
  clientAttrs,
  clientFingerprint,
  recordClientConnection,
  recordSessionId,
} from "../telemetry/client-fingerprint.js";
import { ATTR_MCP_PAPRIKA_TRANSPORT, mcpServerSessionDuration } from "../telemetry/instruments.js";
import { getMeter, getTracer, lazy, startTimer } from "../telemetry/scope.js";
import { ATTR_GEN_AI_TOOL_NAME, ATTR_MCP_METHOD_NAME } from "../telemetry/semconv.js";
import { unwrapAtBoot } from "../utils/errors.js";
import { buildFaviconRouter } from "./favicon.js";
import { buildWidgetPreviewRouter } from "./widget-preview.js";
// Side-effect: every domain/feature module self-registers on import.
import "../kernel/modules.generated.js";

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
  /** Started at initialize — yields elapsed seconds for mcp.server.session.duration at close. */
  readonly elapsedSeconds: () => number;
}

const HTTP_TRANSPORT_ATTR = { [ATTR_MCP_PAPRIKA_TRANSPORT]: "http" } as const;

/** Live MCP sessions; +1 at initialize, −1 at close/eviction. HTTP-only — stdio is one session per process. */
const activeSessions = lazy(() =>
  getMeter().createUpDownCounter("mcp_paprika.sessions.active", {
    description: "Currently active MCP sessions",
    unit: "{session}",
  }),
);

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

/**
 * The @hono/otel request-instrumentation middleware (SERVER spans per request,
 * `http.server.request.duration` + active-requests metrics, incoming
 * `traceparent` extraction), gated past two exclusions:
 *
 * - probe paths — the `PROBE_PATHS` precedent: liveness spam is not telemetry;
 * - `GET /mcp` — the long-lived SSE stream. A span spanning an hours-long
 *   connection never exports until close and is an anti-pattern; the session
 *   metrics carry that signal instead. `POST /mcp` (the actual JSON-RPC
 *   exchanges) keeps its spans, which the kernel's tool/resource spans then
 *   parent under via the active context.
 *
 * Exported for isolated unit testing, same seam as {@link accessLog}.
 */
export function tracedRequests(): MiddlewareHandler {
  // Name a POST /mcp span after the JSON-RPC method the handler stashed on the
  // context (e.g. `POST /mcp tools/call`), so tool calls stand out from the
  // protocol chatter (initialize, tools/list, ping, notifications) that otherwise
  // all share the generic `POST /mcp` name. The factory runs at span finalize too,
  // by which point the stash is set; every other route keeps @hono/otel's default
  // (`METHOD <routePath>`).
  const instrument = httpInstrumentationMiddleware({
    spanNameFactory: (c) => {
      const method = c.get("mcpMethod");
      return typeof method === "string" ? `${c.req.method} /mcp ${method}` : `${c.req.method} ${routePath(c)}`;
    },
  });
  return async (c, next) => {
    if (PROBE_PATHS.has(c.req.path) || (c.req.method === "GET" && c.req.path === "/mcp")) {
      return next();
    }
    return instrument(c, next);
  };
}

/**
 * A child `response.flush` span bracketing the response BODY write — from when the handler resolves
 * its Response to the Node socket's `finish`. The request span (and the inner `resources/read` app
 * span) both close at handler return, BEFORE `@hono/node-server` streams the body; this is the only
 * server-side view of the serialize+write cost (a ~500 KB widget HTML). It measures
 * time-to-kernel-buffer, NOT time-to-client — TCP backpressure hides the rest, which only the
 * client's Resource Timing sees. No-ops outside the node-server adapter (the in-memory test
 * transport sets no `outgoing`), and ends immediately if the body already flushed (a tiny response).
 * Registered INSIDE `tracedRequests`, so `context.active()` here is the request span.
 */
export function tracedFlush(): MiddlewareHandler {
  return async (c, next) => {
    await next();
    const outgoing = (c.env as { outgoing?: ServerResponse }).outgoing;
    if (!outgoing || typeof outgoing.once !== "function") return;
    const span = getTracer().startSpan("response.flush", undefined, context.active());
    let ended = false;
    const end = (): void => {
      if (ended) return;
      ended = true;
      const len = c.res.headers.get("content-length");
      if (len !== null) span.setAttribute("http.response.body.size", Number(len));
      span.end();
    };
    if (outgoing.writableFinished) end();
    else {
      outgoing.once("finish", end);
      outgoing.once("close", end);
    }
  };
}

/**
 * Tag the active request span with the JSON-RPC method (and, for a `tools/call`,
 * the tool name) from a parsed `POST /mcp` body — so the span carries
 * `mcp.method.name` / `gen_ai.tool.name` (matching the kernel's tool span) and
 * the name factory above can title it. Stashes the method on the context for the
 * factory. A body with no `method` (a JSON-RPC response to a server request) is
 * skipped. Best-effort: never throws into request handling.
 */
function tagMcpRequestSpan(c: Context, body: unknown): void {
  const messages = Array.isArray(body) ? body : [body];
  const methods: string[] = [];
  const tools: string[] = [];
  for (const m of messages) {
    const method = (m as { method?: unknown } | null)?.method;
    if (typeof method !== "string") continue;
    methods.push(method);
    const name = method === "tools/call" ? (m as { params?: { name?: unknown } }).params?.name : undefined;
    if (typeof name === "string") tools.push(name);
  }
  if (methods.length === 0) return;
  const method = methods.join(",");
  c.set("mcpMethod", method);
  const span = trace.getActiveSpan();
  if (span !== undefined) {
    span.setAttribute(ATTR_MCP_METHOD_NAME, method);
    if (tools.length > 0) span.setAttribute(ATTR_GEN_AI_TOOL_NAME, tools.join(","));
  }
}

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
      // The mcp-session-id header groups a client's /mcp request sequence into one
      // session (and ties back to its `mcp client connected` fingerprint); absent on
      // initialize and non-/mcp routes.
      const session = c.req.header?.(MCP_SESSION_HEADER);
      const fields = { method: c.req.method, path: c.req.path, status, durationMs, ...(session && { session }) };

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
 * client, kept in a `Map<sessionId, Session>`. The kernel's process-wide state
 * (per-module stores/caches, the vector index) is built once at startup, with
 * auth built alongside it; each session server is built by `kernel.registerAll`.
 * The `notifier` is a `broadcastNotifier` that fans every notification across all
 * live sessions so a mutation made by client A propagates to clients B and C.
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

  // The single eviction point: both the transport's onsessionclosed and the
  // shutdown drain route through here, so the active-sessions counter and the
  // session-duration histogram record exactly once per session (the map
  // delete is the idempotency guard).
  const endSession = (id: string): void => {
    const session = sessions.get(id);
    if (session === undefined) return;
    sessions.delete(id);
    const elapsedSeconds = session.elapsedSeconds();
    const fp = clientFingerprint(session.server.server);
    activeSessions().add(-1, HTTP_TRANSPORT_ATTR);
    // Label the session lifetime with the connecting client (census slice), so
    // session duration is sliceable by client alongside the connect span/counter.
    mcpServerSessionDuration().record(elapsedSeconds, {
      ...HTTP_TRANSPORT_ATTR,
      ...clientAttrs(session.server.server),
    });
    log.info(
      {
        client: fp?.name ?? "unknown",
        clientVersion: fp?.version,
        durationSec: Math.round(elapsedSeconds),
        sessions: sessions.size,
      },
      "mcp client disconnected",
    );
  };

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

  // buildInfraBase authenticates the client (the #158 fast-fail) and resolves the
  // logger + cache dir. buildKernel then constructs every module and runs the initial
  // sync internally, so cold-start vector indexing happens against a populated recipe
  // store. See src/server/build.ts / src/kernel/registry.ts for the ordering rationale.
  const { log: rootLog, client, cacheDir } = await buildInfraBase(config, notifier);

  // Auth needs only its own OAuth client/token subcaches. buildAuthCaches builds JUST
  // those — no entity subcaches, so no duplicate RecipeDiskCache for AuthCleanup's flush
  // loop to clobber, and no second writer over <cacheDir>/<entity>. HTTP-only (stdio has
  // no auth).
  const authCache = unwrapAtBoot(
    await buildAuthCaches(cacheDir, rootLog.child({ component: "auth-cache" })),
    "auth caches init",
  );
  const authContext = await buildAuthContext(config, authCache, rootLog);
  if (authContext !== null) {
    rootLog.info(
      {
        issuer: authContext.config.publicUrl,
        allowlistSize: authContext.config.allowlist.emails.length + authContext.config.allowlist.subs.length,
      },
      "oauth configured",
    );
  }

  const indexEvents = createIndexEvents(rootLog);
  const generatedImageStore = new GeneratedImageStore();
  const kernel = await buildKernel({
    client,
    cacheDir,
    notifier,
    log: rootLog,
    config,
    indexEvents,
    generatedImageStore,
  });

  const log = opts._testLog ?? rootLog.child({ component: "transport-http" });

  // The interval loop runs its first cycle immediately (then waits), so — with
  // buildKernel's initial cycle — startup syncs twice. notifyFromResults turns each
  // cycle's returned results into resourceListChanged notifications, filtered to the
  // change types with a resource surface.
  const loop = config.sync.enabled
    ? runSyncLoop(async () => {
        notifyFromResults(await kernel.syncOnce(), notifier);
      }, config.sync.interval)
    : null;
  if (loop !== null) {
    log.info({ intervalMs: config.sync.interval }, "sync engine started");
  } else {
    log.info("background sync disabled");
  }

  const hono = new Hono();

  // Request spans + HTTP server metrics: outermost, so the access log and
  // every downstream handler run inside the request span (tool spans parent
  // under it via the active context).
  hono.use("*", tracedRequests());

  // Response-flush span: inside the request span, brackets the body write the request/app spans
  // miss (both close at handler return). The only server-side view of serialize+write cost.
  hono.use("*", tracedFlush());

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

  // Connector icon, unauthenticated. Mounted before the /mcp bearer guard (and
  // outside the auth block) so a host's connector flow can fetch it pre-auth —
  // the OAuth AS metadata logo_uri points at this path. See src/utils/branding.ts.
  hono.route("/", buildFaviconRouter());

  // Dev-only widget preview, config-gated and unauthenticated — mounted here,
  // favicon-style, BEFORE the /mcp bearer guard. Absent entirely in production
  // (the flag defaults off). It renders a built widget in a plain browser with a
  // fake host shim; `?payload=` is read client-side by the shim, never reflected
  // by the server. See src/transport/widget-preview.ts.
  if (config.http.widgetPreview) {
    hono.route("/", buildWidgetPreviewRouter(rootLog.child({ component: "widget-preview" })));
  }

  if (authContext !== null) {
    // Capture auth to avoid null-checks inside callbacks (mirrors SyncEngine pattern)
    const auth = authContext;
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
    hono.use("/register", buildClientCap(authCache, MAX_REGISTERED_CLIENTS));

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
    // Tag the request span with the JSON-RPC method (POST only). Hono caches the
    // parsed body, so the transport (and the initialize branch below) re-read it
    // for free; a non-JSON body is left for the transport to reject.
    if (c.req.method === "POST") {
      try {
        tagMcpRequestSpan(c, await c.req.json());
      } catch {
        /* not JSON / not a JSON-RPC message — the transport returns the error */
      }
    }

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

    // Per session: a fresh branded server with every module's tools/resources
    // registered onto it. registerAll is pure (closures over the per-session server;
    // the module state/deps/infra are process-wide and shared), so registering the same
    // tools on N session servers is safe — exactly as buildMcpServer(app) was.
    const server = buildBrandedServer();
    kernel.registerAll(server);
    // Capture the connection fingerprint once per session: clientInfo + the full
    // capability tree + the requested protocol version (from the parsed initialize
    // body, the only place the server sees it — it does not retain the negotiated
    // value). recordClientConnection emits the connect span + census counter + the
    // per-server stash the tool wrapper reads; we log the same fingerprint here (the
    // transport owns the logger). oninitialized fires after the client's initialized
    // notification, so the client reads are populated by then.
    server.server.oninitialized = () => {
      const fp = recordClientConnection(server.server, {
        transport: "http",
        protocolVersion: body.params.protocolVersion,
        // The RAW capabilities (from the parsed initialize body) — they carry the
        // `extensions` map (the apps/widget `io.modelcontextprotocol/ui` axis) that
        // the SDK's getClientCapabilities() strips.
        rawCapabilities: body.params.capabilities,
      });
      log.info({ client: fp }, "mcp client connected");
    };
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { server, transport, elapsedSeconds: startTimer() });
        // Stash the session id so the tool/resource span seams can tag spans with
        // `mcp.session.id` — the cross-request grouping key for a turn's spans (0b/S2).
        recordSessionId(server.server, id);
        activeSessions().add(1, HTTP_TRANSPORT_ATTR);
      },
      onsessionclosed: (id) => {
        endSession(id);
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
  if (authContext !== null) {
    log.info({ issuer: authContext.config.publicUrl }, "OAuth issuer");
    log.info({ upstream: authContext.discovery.issuer, scopes: authContext.config.scopes.join(" ") }, "OAuth upstream");
    log.info(
      {
        emails: authContext.config.allowlist.emails.length,
        subs: authContext.config.allowlist.subs.length,
      },
      "identity allowlist",
    );
    authContext.cleanup.start();
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
        loop?.stop();
        authContext?.cleanup.stop();

        const sessionSnapshot = [...sessions.entries()];
        await Promise.allSettled(sessionSnapshot.map(([, s]) => s.transport.close()));
        // endSession (not clear()) so evicted sessions record their duration
        // and decrement the active counter; transport.close() may have already
        // routed some through onsessionclosed — the map delete makes the
        // second pass a no-op.
        for (const [id] of sessionSnapshot) endSession(id);

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
