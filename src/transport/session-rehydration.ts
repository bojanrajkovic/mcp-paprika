import { StreamableHTTPTransport } from "@hono/mcp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { okAsync, ResultAsync } from "neverthrow";
import type { Logger } from "pino";

import type { CacheError, TryPutOutcome } from "../cache/disk-cache.js";
import type { Kernel } from "../kernel/registry.js";
import type { PersistedSession, SessionDiskCache } from "./session-store.js";

import { subjectMatches } from "../auth/subject.js";
import { buildBrandedServer } from "../server/build.js";
import { recordClientConnection, recordSessionId } from "../telemetry/client-fingerprint.js";
import { ATTR_MCP_PAPRIKA_SESSION_ADOPT_OUTCOME, ATTR_MCP_PAPRIKA_TRANSPORT } from "../telemetry/instruments.js";
import { getMeter, getTracer, lazy, startTimer } from "../telemetry/scope.js";
import { ATTR_MCP_SESSION_ID } from "../telemetry/semconv.js";
import { tracePromise } from "../telemetry/trace-result.js";
import { decideAdopt, isValidSessionId, LAST_SEEN_REFRESH_MS, MAX_PERSISTED_SESSIONS } from "./session-store.js";

export const MCP_SESSION_HEADER = "mcp-session-id";

export interface Session {
  readonly server: McpServer;
  readonly transport: StreamableHTTPTransport;
  /** The OAuth subject that opened this session, or `undefined` under dev-auth bypass. Only that subject may use it. */
  readonly subject: string | undefined;
  /** Started at initialize — yields elapsed seconds for mcp.server.session.duration at close. */
  readonly elapsedSeconds: () => number;
}

export const HTTP_TRANSPORT_ATTR = { [ATTR_MCP_PAPRIKA_TRANSPORT]: "http" } as const;

/** Live MCP sessions; +1 at initialize, −1 at close/eviction. HTTP-only — stdio is one session per process. */
export const activeSessions = lazy(() =>
  getMeter().createUpDownCounter("mcp_paprika.sessions.active", {
    description: "Currently active MCP sessions",
    unit: "{session}",
  }),
);

/** How an adopt attempt for a non-live session id ended; the `mcp_paprika.session.adopt.outcome` span attribute. */
export type AdoptOutcome = "adopted" | "invalid_id" | "not_found" | "expired" | "subject_mismatch" | "failed";

/** The request headers DNS rebinding protection checks, copied onto the synthetic initialize so it passes the same check. */
export interface RequestOrigin {
  readonly host: string | undefined;
  readonly origin: string | undefined;
}

interface RehydrationDeps {
  readonly kernel: Pick<Kernel, "registerAll">;
  readonly store: SessionDiskCache;
  /** The live session map. `startHttp` owns it: /healthz, the notifier, and shutdown read it too. */
  readonly sessions: Map<string, Session>;
  /** `startHttp`'s single eviction point, so a session closed here records the same counters as any other. */
  readonly endSession: (id: string) => void;
  readonly log: Logger;
  readonly allowedHosts: ReadonlyArray<string>;
  readonly allowedOrigins: ReadonlyArray<string>;
}

export interface BuildSessionOpts {
  readonly sessionIdGenerator: () => string;
  readonly protocolVersion: string;
  /** The raw initialize capabilities. They carry the `extensions` map that the SDK's getClientCapabilities() strips. */
  readonly rawCapabilities: unknown;
  readonly subject: string | undefined;
  /** Runs once the transport assigns the id, before the initialize response goes out. */
  readonly onSessionReady: (id: string) => Promise<void>;
}

export interface Rehydration {
  /**
   * Build a server + transport pair and wire the session-map bookkeeping. A client
   * `initialize` (random id) and a rebuild (id pinned to the one being adopted) share
   * this, so both get the same fingerprint, counters, and close handling.
   */
  buildSession(opts: BuildSessionOpts): { readonly server: McpServer; readonly transport: StreamableHTTPTransport };
  /** Persist or refresh a session's record. Best effort: a failure costs restart survival for that session, nothing else. */
  persist(record: PersistedSession): Promise<void>;
  /**
   * The live session for `id` if `subject` owns it; otherwise rebuild it from its
   * persisted record if the record allows; otherwise `null` (the caller 404s).
   * Concurrent requests for the same id and subject share one rebuild.
   */
  adoptOrNull(id: string, subject: string | undefined, requestOrigin: RequestOrigin): Promise<Session | null>;
  /** Drop expired and unparseable records. Called at boot; `persist` also calls it, at most hourly, when the cap is reached. */
  prune(): Promise<void>;
}

/**
 * HTTP session building and restart survival. A session's record is written at
 * initialize; after a restart, a request for that id rebuilds the session by driving
 * a synthetic `initialize` + `notifications/initialized` through `@hono/mcp`'s own
 * code path, so the transport assigns the id and the server restores the client's
 * capabilities. See docs/adr/0027-session-rehydration.md.
 */
export function buildRehydration(deps: RehydrationDeps): Rehydration {
  const { kernel, store, sessions, endSession, log } = deps;
  // DNS rebinding protection is on iff either allowlist is set. The transport's
  // allowedHosts/allowedOrigins options carry @deprecated JSDoc in the SDK (it suggests
  // external middleware), but they still work and are the smallest surface for this.
  // If the SDK removes them, swap to a Hono middleware on /mcp.
  const dnsRebindingProtection = deps.allowedHosts.length > 0 || deps.allowedOrigins.length > 0;

  // When each live session last refreshed its record's `lastSeenAt`.
  const lastTouchedAt = new Map<string, number>();

  // When the last sweep ran. At the cap, `persist` sweeps only if this is stale: with
  // the cap full of live records, a sweep per initialize would read every record on
  // every connect and free nothing.
  let lastPruneAt = 0;

  async function prune(): Promise<void> {
    lastPruneAt = Date.now();
    (await store.pruneExpired(lastPruneAt)).match(
      (removed) => {
        if (removed > 0) log.info({ removed }, "pruned expired session records");
      },
      (e) => log.warn({ err: e }, "failed to prune expired session records"),
    );
  }

  function buildSession(opts: BuildSessionOpts): {
    readonly server: McpServer;
    readonly transport: StreamableHTTPTransport;
  } {
    // registerAll is pure (closures over the per-session server; module state is
    // process-wide), so registering the same tools on N session servers is safe.
    const server = buildBrandedServer();
    kernel.registerAll(server);
    // oninitialized fires after the client's initialized notification, so the
    // client reads behind the fingerprint are populated by then.
    server.server.oninitialized = () => {
      const fp = recordClientConnection(server.server, {
        transport: "http",
        protocolVersion: opts.protocolVersion,
        rawCapabilities: opts.rawCapabilities,
      });
      log.info({ client: fp }, "mcp client connected");
    };
    const transport = new StreamableHTTPTransport({
      sessionIdGenerator: opts.sessionIdGenerator,
      onsessioninitialized: async (id) => {
        sessions.set(id, { server, transport, subject: opts.subject, elapsedSeconds: startTimer() });
        lastTouchedAt.set(id, Date.now());
        // Lets the tool/resource span seams tag spans with `mcp.session.id`.
        recordSessionId(server.server, id);
        activeSessions().add(1, HTTP_TRANSPORT_ATTR);
        await opts.onSessionReady(id);
      },
      // A client DELETE ends the session for good, so its record goes too. The
      // shutdown drain calls endSession directly and keeps records: surviving
      // that restart is the point.
      onsessionclosed: async (id) => {
        endSession(id);
        lastTouchedAt.delete(id);
        (await store.remove(id)).match(
          () => undefined,
          (e) => log.warn({ err: e, sessionId: id }, "failed to remove a closed session's record"),
        );
      },
      allowedHosts: [...deps.allowedHosts],
      allowedOrigins: [...deps.allowedOrigins],
      enableDnsRebindingProtection: dnsRebindingProtection,
    });
    return { server, transport };
  }

  async function persist(record: PersistedSession): Promise<void> {
    const put = () =>
      store.tryPut(record, MAX_PERSISTED_SESSIONS).andThen((outcome) => store.flush().map(() => outcome));
    // At the cap, sweep out dead records (if no sweep ran recently) and try once more.
    const sweepAndRetry = (outcome: TryPutOutcome): ResultAsync<TryPutOutcome, CacheError> =>
      outcome.ok || Date.now() - lastPruneAt < LAST_SEEN_REFRESH_MS
        ? okAsync(outcome)
        : ResultAsync.fromSafePromise(prune()).andThen(put);
    (await put().andThen(sweepAndRetry)).match(
      (outcome) => {
        if (!outcome.ok) {
          log.warn(
            { sessionId: record.sessionId, currentCount: outcome.currentCount },
            "session record cap reached; this session won't survive a restart",
          );
        }
      },
      (e) => log.warn({ err: e, sessionId: record.sessionId }, "failed to persist session record"),
    );
  }

  /** Rebuild a session from its record. Any failure reads as an unknown session (the caller 404s), never a 500. */
  async function rehydrate(
    record: PersistedSession,
    requestOrigin: RequestOrigin,
    sessionLog: Logger,
  ): Promise<Session | null> {
    const id = record.sessionId;
    const failed = (reason: unknown): null => {
      sessionLog.warn({ err: reason }, "session rehydration failed; treating as unknown session");
      // The synthetic initialize may have inserted `id` before a later step failed;
      // evict it so no half-built session is ever served.
      endSession(id);
      lastTouchedAt.delete(id);
      return null;
    };
    try {
      const { server, transport } = buildSession({
        sessionIdGenerator: () => id,
        protocolVersion: record.protocolVersion,
        rawCapabilities: record.capabilities,
        subject: record.subject,
        // Not awaited: a burst of reconnects after a restart shouldn't queue on one
        // fsync per session to refresh a TTL clock. A lost refresh only makes the
        // expiry slightly early.
        onSessionReady: () => {
          void persist({ ...record, lastSeenAt: new Date().toISOString() });
          return Promise.resolve();
        },
      });
      await server.connect(transport);

      const inner = new Hono();
      inner.all("/mcp", async (ic) => (await transport.handleRequest(ic)) ?? ic.body(null, 204));
      const headers = {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...(requestOrigin.host !== undefined ? { host: requestOrigin.host } : {}),
        ...(requestOrigin.origin !== undefined ? { origin: requestOrigin.origin } : {}),
      };
      const initRes = await inner.request("/mcp", {
        method: "POST",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 0,
          method: "initialize",
          params: {
            protocolVersion: record.protocolVersion,
            capabilities: record.capabilities,
            clientInfo: record.clientInfo,
          },
        }),
      });
      if (initRes.status !== 200) return failed(`synthetic initialize returned ${initRes.status.toString()}`);

      // A notification-only POST gets a bare 202 from the transport on success.
      const initializedRes = await inner.request("/mcp", {
        method: "POST",
        headers: { ...headers, [MCP_SESSION_HEADER]: id },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      if (initializedRes.status !== 202) {
        return failed(`synthetic notifications/initialized returned ${initializedRes.status.toString()}`);
      }

      const session = sessions.get(id);
      if (session === undefined) return failed("session missing from the map after synthetic initialize");
      return session;
    } catch (err) {
      // Only a foreign throw from @hono/mcp, the SDK, or Hono lands here; our own
      // checks above return null directly.
      return failed(err);
    }
  }

  async function adopt(
    id: string,
    subject: string | undefined,
    requestOrigin: RequestOrigin,
  ): Promise<{ readonly outcome: AdoptOutcome; readonly session: Session | null }> {
    // Before any disk read: the header is client input and becomes a file path.
    if (!isValidSessionId(id)) return { outcome: "invalid_id", session: null };
    const sessionLog = log.child({ sessionId: id });

    const record = await store.get(id).match(
      (r) => r,
      (e) => {
        sessionLog.warn({ err: e }, "failed to read session record; treating as unknown session");
        return null;
      },
    );
    const decision = decideAdopt(record, subject, Date.now());
    if (decision.kind === "reject") {
      if (decision.reason === "expired") {
        (await store.remove(id)).match(
          () => undefined,
          (e) => sessionLog.warn({ err: e }, "failed to prune expired session record"),
        );
      }
      return { outcome: decision.reason, session: null };
    }

    const session = await rehydrate(decision.record, requestOrigin, sessionLog);
    if (session !== null) sessionLog.info("adopted session");
    return { outcome: session !== null ? "adopted" : "failed", session };
  }

  /**
   * Refresh a live session's `lastSeenAt` at most every LAST_SEEN_REFRESH_MS, so the
   * TTL counts from last use. Fire-and-forget: a lost refresh only makes the expiry
   * early. A record that's gone (the client deleted the session) stays gone.
   */
  function touch(id: string): void {
    const now = Date.now();
    if (now - (lastTouchedAt.get(id) ?? 0) < LAST_SEEN_REFRESH_MS) return;
    lastTouchedAt.set(id, now);
    void store.get(id).match(
      (record) => (record !== null ? persist({ ...record, lastSeenAt: new Date(now).toISOString() }) : undefined),
      (e) => log.warn({ err: e, sessionId: id }, "failed to read session record for a lastSeenAt refresh"),
    );
  }

  // Keyed by id AND subject: two racing requests for one id under different tokens
  // must each get their own subject check, not share the winner's.
  const inflight = new Map<string, Promise<Session | null>>();

  function adoptOrNull(id: string, subject: string | undefined, requestOrigin: RequestOrigin): Promise<Session | null> {
    // A JSON tuple, not a joined string: the id is unvalidated client input here.
    const key = JSON.stringify([id, subject]);
    const pending = inflight.get(key);
    // A rebuild puts its session in the map partway through the synthetic handshake,
    // so a request racing it must join the rebuild, not take the half-built session.
    if (pending !== undefined) return pending;

    const live = sessions.get(id);
    if (live !== undefined) {
      // A live id under a different subject reads as unknown, so a leaked or guessed
      // id can't ride another principal's session or confirm that it exists.
      if (!subjectMatches(subject, live.subject)) return Promise.resolve(null);
      touch(id);
      return Promise.resolve(live);
    }

    const rebuild = tracePromise(
      getTracer(),
      "mcp_paprika.session.adopt",
      { attributes: { [ATTR_MCP_SESSION_ID]: id } },
      async () => {
        const { outcome, session } = await adopt(id, subject, requestOrigin);
        trace.getActiveSpan()?.setAttribute(ATTR_MCP_PAPRIKA_SESSION_ADOPT_OUTCOME, outcome);
        return session;
      },
    ).finally(() => inflight.delete(key));
    inflight.set(key, rebuild);
    return rebuild;
  }

  return { buildSession, persist, adoptOrNull, prune };
}
