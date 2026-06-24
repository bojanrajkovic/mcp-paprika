// The connection fingerprint a host advertises at the MCP `initialize` handshake:
// `clientInfo` (name/version/title), the requested `protocolVersion`, the transport,
// and the full client-capability tree. Captured once per session and emitted on every
// observability channel — a point-in-time span, a census counter, and (at the caller's
// seam, which owns the logger) a structured connect log — then stashed so the kernel
// tool wrapper can tag each session's tools/call spans with WHICH client drove them.
//
// Telemetry RECORDING lives here (the global OTel API, per ADR-0018); the LOG is
// emitted by the transport, which threads the pino logger via `Infra`. So
// `recordClientConnection` records the span + counter + stash and RETURNS the rich
// {@link ClientFingerprint} for the transport to log — one capture, every channel.
//
// Discipline (ADR-0018 + the telemetry-attributes conformance gate): `clientInfo` is
// the MCP CLIENT APP's self-reported identity (name/version), NOT the OAuth user — no
// PII or token material rides here on either transport. The census COUNTER carries only
// name + major-version + transport (cardinality-bounded); the full version string and
// the capability tree go on the SPAN, which tolerates detail a metric label cannot.

import type { ClientCapabilities, Implementation } from "@modelcontextprotocol/sdk/types.js";
import { type Attributes, SpanKind } from "@opentelemetry/api";

import { ATTR_MCP_PAPRIKA_TRANSPORT } from "./instruments.js";
import { getMeter, getTracer, lazy } from "./scope.js";

/** Which transport carried the session — the value of the shared `mcp_paprika.transport` dimension. */
export type TransportKind = "stdio" | "http";

/**
 * The slice of the per-session MCP server this module reads — the same two
 * accessors {@link ElicitationServer} narrows to, plus the client version. The
 * per-session base `Server` (`ctx.server.server`) satisfies it structurally, so
 * the fingerprint module never imports the heavy `Server` class (the same
 * least-privilege narrowing `DomainCtx`/`ElicitationServer` apply).
 */
export interface FingerprintServer {
  getClientVersion(): Implementation | undefined;
  getClientCapabilities(): ClientCapabilities | undefined;
}

/**
 * A host's connection fingerprint, in loggable shape: the structured object the
 * transport logs at connect AND the source of every telemetry attribute. The
 * capability tree is flattened to booleans (`elicitationForm` is the field the
 * confirm/pick gates check), with `experimental` keys carried as a list (the
 * apps/widget axis lands there).
 */
export interface ClientFingerprint {
  readonly name: string;
  readonly version: string;
  readonly versionMajor: string;
  readonly title?: string;
  readonly protocolVersion?: string;
  readonly transport: TransportKind;
  readonly capabilities: {
    readonly roots: boolean;
    readonly sampling: boolean;
    readonly elicitation: boolean;
    readonly elicitationForm: boolean;
    readonly experimental: ReadonlyArray<string>;
  };
}

// Custom telemetry names (the `mcp_paprika.` prefix per ADR-0018; the
// telemetry-attributes conformance gate validates their shape + that no terminal
// is an identity/credential segment). `transport` reuses the shared
// `mcp_paprika.transport` constant so a session's connect span, census counter,
// session-duration histogram, and tool spans all label transport identically.

/** Client app name, e.g. `claude-ai`, `Claude Code`, `cursor-vscode`. Low-cardinality (stable per client). */
export const ATTR_CLIENT_NAME = "mcp_paprika.client.name";
/** Full client version string — SPAN only (every patch is a distinct value; too high-cardinality for a metric label). */
export const ATTR_CLIENT_VERSION = "mcp_paprika.client.version";
/** Major-version bucket of the client version — the cardinality-bounded version dimension for metric labels. */
export const ATTR_CLIENT_VERSION_MAJOR = "mcp_paprika.client.version_major";
/** Client app title when advertised (the human-facing name beside the machine `name`). SPAN only. */
export const ATTR_CLIENT_TITLE = "mcp_paprika.client.title";
/** The protocol version the client REQUESTED at initialize, e.g. `2025-06-18`. SPAN only. */
export const ATTR_CLIENT_PROTOCOL_VERSION = "mcp_paprika.client.protocol_version";
/** Whether the client advertised the `roots` capability. */
export const ATTR_CLIENT_CAP_ROOTS = "mcp_paprika.client.cap.roots";
/** Whether the client advertised the `sampling` capability. */
export const ATTR_CLIENT_CAP_SAMPLING = "mcp_paprika.client.cap.sampling";
/** Whether the client advertised any `elicitation` capability. */
export const ATTR_CLIENT_CAP_ELICITATION = "mcp_paprika.client.cap.elicitation";
/** Whether the client advertised FORM-mode elicitation (the field the confirm/pick gates check). */
export const ATTR_CLIENT_CAP_ELICITATION_FORM = "mcp_paprika.client.cap.elicitation_form";
/** Sorted, comma-joined `experimental` capability keys (the apps/widget axis lands here). SPAN only; omitted when none. */
export const ATTR_CLIENT_CAP_EXPERIMENTAL = "mcp_paprika.client.cap.experimental";

/** Per-connection census; labeled by client name + bucketed version + transport (cardinality-bounded). */
const clientConnections = lazy(() =>
  getMeter().createCounter("mcp_paprika.client.connections", {
    description: "MCP client connections by client name, major version, and transport",
    unit: "{connection}",
  }),
);

/**
 * The session fingerprint stashed per server so the kernel tool wrapper can tag
 * each tools/call span (and the session-duration histogram) with the connecting
 * client. A `WeakMap` keyed by the per-session server instance: the entry dies
 * with the server, so an evicted HTTP session leaves nothing behind. Read via
 * {@link clientAttrs} (the low-cardinality telemetry slice) or
 * {@link clientFingerprint} (the full object, for the disconnect log).
 */
const fingerprints = new WeakMap<FingerprintServer, ClientFingerprint>();

/** Major-version bucket: the segment before the first `.`, or the whole string when there is none. */
function majorVersion(version: string): string {
  const dot = version.indexOf(".");
  return dot === -1 ? version : version.slice(0, dot);
}

/** Build the loggable fingerprint from the server's post-handshake client reads. */
function describeClient(
  server: FingerprintServer,
  opts: { readonly transport: TransportKind; readonly protocolVersion?: string | undefined },
): ClientFingerprint {
  const info = server.getClientVersion();
  const caps = server.getClientCapabilities();
  const version = info?.version ?? "unknown";
  return {
    name: info?.name ?? "unknown",
    version,
    versionMajor: majorVersion(version),
    ...(info?.title !== undefined && { title: info.title }),
    ...(opts.protocolVersion !== undefined && { protocolVersion: opts.protocolVersion }),
    transport: opts.transport,
    capabilities: {
      roots: caps?.roots !== undefined,
      sampling: caps?.sampling !== undefined,
      elicitation: caps?.elicitation !== undefined,
      elicitationForm: caps?.elicitation?.form !== undefined,
      experimental: caps?.experimental ? Object.keys(caps.experimental).sort() : [],
    },
  };
}

/**
 * The low-cardinality census slice — client name, major version, transport. The
 * ONLY dimensions allowed on the connections counter, the session-duration
 * histogram, and the tool-call spans (a client-controlled full version or
 * capability detail would blow up a metric's series count).
 */
function censusAttrs(fp: ClientFingerprint): Attributes {
  return {
    [ATTR_CLIENT_NAME]: fp.name,
    [ATTR_CLIENT_VERSION_MAJOR]: fp.versionMajor,
    [ATTR_MCP_PAPRIKA_TRANSPORT]: fp.transport,
  };
}

/**
 * Record a client's connection fingerprint at the `initialize` handshake, and
 * return it for the caller to log. Reads `clientInfo` + capabilities off the
 * per-session server (populated by the time the client's `initialized`
 * notification fires), emits a point-in-time `mcp_paprika.client.connect` span
 * carrying the full capability tree as attributes, increments the
 * `mcp_paprika.client.connections` census counter with the low-cardinality
 * slice, and stashes the fingerprint for the tool wrapper and the disconnect log.
 *
 * A point-in-time span (opened and ended here), NOT a session-lifetime span: a
 * span spanning the whole connection never exports until close — under stdio
 * that is the entire process lifetime — the same anti-pattern the HTTP
 * transport's `GET /mcp` SSE exclusion avoids. The session DURATION is the
 * existing `mcp.server.session.duration` histogram, recorded at close (now
 * labeled with the census slice via {@link clientAttrs}).
 *
 * Never throws (OTel API calls don't, and the reads are guarded) — telemetry
 * must not alter the handshake (ADR-0018).
 */
export function recordClientConnection(
  server: FingerprintServer,
  opts: { readonly transport: TransportKind; readonly protocolVersion?: string | undefined },
): ClientFingerprint {
  const fp = describeClient(server, opts);
  const census = censusAttrs(fp);

  const experimental = fp.capabilities.experimental.join(",");
  const spanAttrs: Attributes = {
    ...census,
    [ATTR_CLIENT_VERSION]: fp.version,
    [ATTR_CLIENT_CAP_ROOTS]: fp.capabilities.roots,
    [ATTR_CLIENT_CAP_SAMPLING]: fp.capabilities.sampling,
    [ATTR_CLIENT_CAP_ELICITATION]: fp.capabilities.elicitation,
    [ATTR_CLIENT_CAP_ELICITATION_FORM]: fp.capabilities.elicitationForm,
    ...(fp.title !== undefined && { [ATTR_CLIENT_TITLE]: fp.title }),
    ...(fp.protocolVersion !== undefined && { [ATTR_CLIENT_PROTOCOL_VERSION]: fp.protocolVersion }),
    ...(experimental.length > 0 && { [ATTR_CLIENT_CAP_EXPERIMENTAL]: experimental }),
  };

  getTracer().startSpan("mcp_paprika.client.connect", { kind: SpanKind.INTERNAL, attributes: spanAttrs }).end();
  clientConnections().add(1, census);
  fingerprints.set(server, fp);
  return fp;
}

/**
 * The stashed low-cardinality census slice for a session's server, or an empty
 * object when no connection was recorded (a client that never sent
 * `initialized`, or telemetry read before the handshake completed). The kernel
 * tool wrapper spreads it onto every tools/call span so the structured-output
 * telemetry can be sliced by client, and the transports spread it onto the
 * session-duration histogram; an empty object adds no attributes, so an
 * un-fingerprinted call/session degrades cleanly.
 */
export function clientAttrs(server: FingerprintServer): Attributes {
  const fp = fingerprints.get(server);
  return fp ? censusAttrs(fp) : {};
}

/** The full stashed fingerprint for a session's server, for the disconnect log; `undefined` if none was recorded. */
export function clientFingerprint(server: FingerprintServer): ClientFingerprint | undefined {
  return fingerprints.get(server);
}
