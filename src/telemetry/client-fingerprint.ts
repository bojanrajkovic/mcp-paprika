// The connection fingerprint a host advertises at the MCP `initialize` handshake:
// `clientInfo` (name/version/title), the requested `protocolVersion`, the transport,
// and the full client-capability tree. Captured once per session and emitted on every
// observability channel — a point-in-time span, a census counter, and (at the caller's
// seam, which owns the logger) a structured connect log — then stashed so the kernel
// tool wrapper can tag each session's tools/call spans with WHICH client drove them.
//
// Telemetry RECORDING lives here (the global OTel API); the LOG is
// emitted by the transport, which threads the pino logger via `Infra`. So
// `recordClientConnection` records the span + counter + stash and RETURNS the rich
// {@link ClientFingerprint} for the transport to log — one capture, every channel.
//
// Discipline (enforced by the telemetry-attributes conformance gate): `clientInfo` is
// the MCP CLIENT APP's self-reported identity (name/version), NOT the OAuth user — no
// PII or token material rides here on either transport. The census COUNTER carries only
// name + major-version + transport (cardinality-bounded); the full version string and
// the capability tree go on the SPAN, which tolerates detail a metric label cannot.

import type { ClientCapabilities, Implementation } from "@modelcontextprotocol/sdk/types.js";
import { type Attributes, SpanKind } from "@opentelemetry/api";

import { ATTR_MCP_PAPRIKA_TRANSPORT } from "./instruments.js";
import { getMeter, getTracer, lazy } from "./scope.js";
import { ATTR_MCP_SESSION_ID } from "./semconv.js";

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

/** The MCP UI / apps-widget capability key, advertised by hosts under `capabilities.extensions`. */
export const MCP_UI_EXTENSION = "io.modelcontextprotocol/ui";

/**
 * A host's connection fingerprint, in loggable shape: the structured object the
 * transport logs at connect AND the source of every telemetry attribute.
 *
 * `capabilities` is the **raw, verbatim** capability tree the client sent at
 * `initialize` — logged whole, on purpose: it is future-proof (any capability,
 * known or not, shows up) and it carries the top-level `extensions` map where the
 * apps/widget capability (`io.modelcontextprotocol/ui`, with its rendered MIME
 * types) lives — a key the SDK's `ClientCapabilities` schema STRIPS, so it must
 * come from the raw initialize params rather than `getClientCapabilities()`. The
 * span (which can't hold a nested object) derives bounded scalars from it; the log
 * keeps the whole thing.
 */
export interface ClientFingerprint {
  readonly name: string;
  readonly version: string;
  readonly versionMajor: string;
  readonly title?: string;
  readonly protocolVersion?: string;
  readonly transport: TransportKind;
  readonly capabilities: Readonly<Record<string, unknown>>;
}

// Custom telemetry names (the `mcp_paprika.` prefix; the
// telemetry-attributes conformance gate validates their shape + that no terminal
// is an identity/credential segment). `transport` reuses the shared
// `mcp_paprika.transport` constant so a session's connect span, census counter,
// session-duration histogram, and tool spans all label transport identically.

/** Client app name, e.g. `claude-ai`, `Claude Code`. A metric label — length-capped (client-supplied); stable per legitimate client. */
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
/** Sorted, comma-joined `experimental` capability keys. SPAN only; omitted when none. */
export const ATTR_CLIENT_CAP_EXPERIMENTAL = "mcp_paprika.client.cap.experimental";
/** Whether the client advertised the `io.modelcontextprotocol/ui` apps/widget extension. */
export const ATTR_CLIENT_CAP_UI = "mcp_paprika.client.cap.ui";
/** The UI extension's rendered MIME types, comma-joined. SPAN only; omitted when no UI capability. */
export const ATTR_CLIENT_CAP_UI_MIME_TYPES = "mcp_paprika.client.cap.ui_mime_types";
/** Sorted, comma-joined `extensions` keys (the open-ended capability axis the SDK schema strips). SPAN only; omitted when none. */
export const ATTR_CLIENT_CAP_EXTENSIONS = "mcp_paprika.client.cap.extensions";

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

/**
 * The MCP session id stashed per server, set at the transport's `onsessioninitialized`
 * (the only place the id and the server coincide), read at call time by the tool and
 * resource span seams via {@link sessionAttrs}. Same `WeakMap`-keyed-by-server pattern
 * as {@link fingerprints} — the entry dies with the server, so an evicted session leaves
 * nothing behind. HTTP-only: stdio is one session per process and records none.
 */
const sessionIds = new WeakMap<FingerprintServer, string>();

// `clientInfo` is client-supplied, so the values that become METRIC LABELS (name +
// major version) are length-capped: a metric label is bounded in size, and on the
// OAuth HTTP transport a client controls these strings. The cap bounds label SIZE;
// the count of distinct values is bounded operationally by the OAuth allowlist (only
// admitted identities connect) — a buggy client that randomizes its name is the
// residual, accepted risk. The full version string is never a label (span only), so
// it is not capped here.
const MAX_NAME_LABEL = 64;
const MAX_VERSION_MAJOR_LABEL = 16;

/** Cap a label value's length so a pathological client string can't bloat a metric series. */
function clampLabel(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

/** Major-version bucket: the segment before the first `.`, or the whole string when there is none. */
function majorVersion(version: string): string {
  const dot = version.indexOf(".");
  return dot === -1 ? version : version.slice(0, dot);
}

/** A record or `{}` — for safely reading the raw, untyped capability tree. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Build the loggable fingerprint from the server's post-handshake client reads.
 *
 * Capabilities are read from the RAW initialize `params.capabilities` when the
 * caller has it (both transports do), NOT `getClientCapabilities()`: the SDK's
 * `ClientCapabilities` schema strips every key it does not model — including the
 * top-level `extensions` map where the apps/widget capability
 * (`io.modelcontextprotocol/ui`) lives — so the parsed view silently loses it.
 * The raw object is the authoritative source; it falls back to the parsed view
 * only when no raw object was threaded in (e.g. a unit test).
 */
function describeClient(
  server: FingerprintServer,
  opts: {
    readonly transport: TransportKind;
    readonly protocolVersion?: string | undefined;
    readonly rawCapabilities?: unknown;
  },
): ClientFingerprint {
  const info = server.getClientVersion();
  const version = info?.version ?? "unknown";
  return {
    name: clampLabel(info?.name ?? "unknown", MAX_NAME_LABEL),
    version,
    versionMajor: clampLabel(majorVersion(version), MAX_VERSION_MAJOR_LABEL),
    ...(info?.title !== undefined && { title: info.title }),
    ...(opts.protocolVersion !== undefined && { protocolVersion: opts.protocolVersion }),
    transport: opts.transport,
    // The raw capability tree, verbatim (logged whole). Prefer the RAW initialize
    // params — they carry the `extensions` map the SDK's getClientCapabilities()
    // strips; fall back to the parsed view only when no raw object was threaded in.
    capabilities: asRecord(opts.rawCapabilities ?? server.getClientCapabilities()),
  };
}

/** The UID-or-text-free scalar slice the connect SPAN carries, derived from the raw capability tree. */
function capabilitySpanAttrs(caps: Readonly<Record<string, unknown>>): Attributes {
  const extensions = asRecord(caps["extensions"]);
  const uiExt = extensions[MCP_UI_EXTENSION];
  const uiMimeTypes = ((asRecord(uiExt)["mimeTypes"] ?? []) as ReadonlyArray<unknown>)
    .filter((m): m is string => typeof m === "string")
    .join(",");
  const experimental = Object.keys(asRecord(caps["experimental"])).sort().join(",");
  const extensionKeys = Object.keys(extensions).sort().join(",");
  return {
    [ATTR_CLIENT_CAP_ROOTS]: caps["roots"] !== undefined,
    [ATTR_CLIENT_CAP_SAMPLING]: caps["sampling"] !== undefined,
    [ATTR_CLIENT_CAP_ELICITATION]: caps["elicitation"] !== undefined,
    [ATTR_CLIENT_CAP_ELICITATION_FORM]: asRecord(caps["elicitation"])["form"] !== undefined,
    [ATTR_CLIENT_CAP_UI]: uiExt !== undefined,
    ...(experimental.length > 0 && { [ATTR_CLIENT_CAP_EXPERIMENTAL]: experimental }),
    ...(extensionKeys.length > 0 && { [ATTR_CLIENT_CAP_EXTENSIONS]: extensionKeys }),
    ...(uiMimeTypes.length > 0 && { [ATTR_CLIENT_CAP_UI_MIME_TYPES]: uiMimeTypes }),
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
 * must not alter the handshake.
 */
export function recordClientConnection(
  server: FingerprintServer,
  opts: {
    readonly transport: TransportKind;
    readonly protocolVersion?: string | undefined;
    /** The RAW initialize `params.capabilities` — carries `extensions`, which the SDK schema strips. */
    readonly rawCapabilities?: unknown;
  },
): ClientFingerprint {
  // Idempotent per session server: a client that re-sends the `initialized`
  // notification (off-spec, but cheap to tolerate) must not double-count the census
  // or re-emit a connect span. The first record wins.
  const already = fingerprints.get(server);
  if (already !== undefined) return already;

  const fp = describeClient(server, opts);
  const census = censusAttrs(fp);

  const spanAttrs: Attributes = {
    ...census,
    [ATTR_CLIENT_VERSION]: fp.version,
    ...capabilitySpanAttrs(fp.capabilities),
    ...(fp.title !== undefined && { [ATTR_CLIENT_TITLE]: fp.title }),
    ...(fp.protocolVersion !== undefined && { [ATTR_CLIENT_PROTOCOL_VERSION]: fp.protocolVersion }),
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

/**
 * Stash the MCP session id for a server, called once at `onsessioninitialized`. Idempotent
 * (the first id wins); never throws (a plain `WeakMap.set`). Keyed by the SAME per-session
 * `server` the tool/resource span seams pass to {@link sessionAttrs}, so the lookup hits.
 */
export function recordSessionId(server: FingerprintServer, sessionId: string): void {
  if (!sessionIds.has(server)) sessionIds.set(server, sessionId);
}

/**
 * The `mcp.session.id` span attribute for a session's server, or an empty object when none
 * was recorded (stdio, or a span before the session initialized). SPAN-ONLY — per-session,
 * so it must never label a metric. The tool wrapper and the resource-read wrapper spread it
 * onto their spans so a turn's tool calls and widget render spans group by session (0b/S2).
 */
export function sessionAttrs(server: FingerprintServer): Attributes {
  const id = sessionIds.get(server);
  return id !== undefined ? { [ATTR_MCP_SESSION_ID]: id } : {};
}
