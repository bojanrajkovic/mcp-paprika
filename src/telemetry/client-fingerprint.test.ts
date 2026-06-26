import type { ClientCapabilities, Implementation } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it } from "vitest";

import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import {
  ATTR_CLIENT_CAP_ELICITATION,
  ATTR_CLIENT_CAP_ELICITATION_FORM,
  ATTR_CLIENT_CAP_EXPERIMENTAL,
  ATTR_CLIENT_CAP_EXTENSIONS,
  ATTR_CLIENT_CAP_ROOTS,
  ATTR_CLIENT_CAP_SAMPLING,
  ATTR_CLIENT_CAP_UI,
  ATTR_CLIENT_CAP_UI_MIME_TYPES,
  ATTR_CLIENT_NAME,
  ATTR_CLIENT_PROTOCOL_VERSION,
  ATTR_CLIENT_TITLE,
  ATTR_CLIENT_VERSION,
  ATTR_CLIENT_VERSION_MAJOR,
  clientAttrs,
  clientFingerprint,
  type FingerprintServer,
  recordClientConnection,
  recordSessionId,
  sessionAttrs,
} from "./client-fingerprint.js";
import { ATTR_MCP_PAPRIKA_TRANSPORT } from "./instruments.js";
import { ATTR_MCP_SESSION_ID } from "./semconv.js";

// Module scope, before any recording — shared instruments memoize against the
// global meter provider on first record (see the helper's doc-comment).
const telemetry = installTestTelemetry();

beforeEach(() => {
  telemetry.spanExporter.reset();
});

/** A FingerprintServer stub — exactly the two reads recordClientConnection makes. */
function stub(info: Implementation | undefined, caps: ClientCapabilities | undefined): FingerprintServer {
  return { getClientVersion: () => info, getClientCapabilities: () => caps };
}

const CONNECT_SPAN = "mcp_paprika.client.connect";

describe("recordClientConnection", () => {
  it("emits a connect span carrying the full fingerprint as attributes", () => {
    const server = stub(
      { name: "claude-ai", version: "1.4.2", title: "Claude" },
      { roots: {}, elicitation: { form: {} }, experimental: { "io.modelcontextprotocol/apps": {} } },
    );

    recordClientConnection(server, { transport: "http", protocolVersion: "2025-06-18" });

    const spans = telemetry.spansNamed(CONNECT_SPAN);
    expect(spans).toHaveLength(1);
    const a = spans[0]!.attributes;
    expect(a[ATTR_CLIENT_NAME]).toBe("claude-ai");
    expect(a[ATTR_CLIENT_VERSION]).toBe("1.4.2");
    expect(a[ATTR_CLIENT_VERSION_MAJOR]).toBe("1");
    expect(a[ATTR_CLIENT_TITLE]).toBe("Claude");
    expect(a[ATTR_CLIENT_PROTOCOL_VERSION]).toBe("2025-06-18");
    expect(a[ATTR_MCP_PAPRIKA_TRANSPORT]).toBe("http");
    expect(a[ATTR_CLIENT_CAP_ROOTS]).toBe(true);
    expect(a[ATTR_CLIENT_CAP_SAMPLING]).toBe(false);
    expect(a[ATTR_CLIENT_CAP_ELICITATION]).toBe(true);
    expect(a[ATTR_CLIENT_CAP_ELICITATION_FORM]).toBe(true);
    expect(a[ATTR_CLIENT_CAP_EXPERIMENTAL]).toBe("io.modelcontextprotocol/apps");
    expect(a[ATTR_CLIENT_CAP_UI]).toBe(false); // no `extensions` advertised here
  });

  it("captures the apps/UI extension (io.modelcontextprotocol/ui) the SDK schema strips", () => {
    // The UI capability lives under a top-level `extensions` key — pass it as the RAW
    // capabilities, since the SDK's getClientCapabilities() would drop it entirely.
    const rawCapabilities = {
      roots: {},
      extensions: {
        "io.modelcontextprotocol/ui": { mimeTypes: ["text/html;profile=mcp-app", "text/html+mcp"] },
      },
    };
    const server = stub({ name: "claude-ai", version: "0.1.0" }, {});
    recordClientConnection(server, { transport: "stdio", rawCapabilities });

    const a = telemetry.spansNamed(CONNECT_SPAN)[0]!.attributes;
    expect(a[ATTR_CLIENT_CAP_UI]).toBe(true);
    expect(a[ATTR_CLIENT_CAP_UI_MIME_TYPES]).toBe("text/html;profile=mcp-app,text/html+mcp");
    expect(a[ATTR_CLIENT_CAP_EXTENSIONS]).toBe("io.modelcontextprotocol/ui");
    // The logged fingerprint keeps the raw capability tree verbatim (extensions intact).
    expect(clientFingerprint(server)?.capabilities).toEqual(rawCapabilities);
  });

  it("omits optional attributes when the client did not advertise them", () => {
    const server = stub({ name: "mcp-cli", version: "0.9" }, {});
    recordClientConnection(server, { transport: "stdio" });

    const a = telemetry.spansNamed(CONNECT_SPAN)[0]!.attributes;
    expect(a[ATTR_CLIENT_TITLE]).toBeUndefined();
    expect(a[ATTR_CLIENT_PROTOCOL_VERSION]).toBeUndefined();
    expect(a[ATTR_CLIENT_CAP_EXPERIMENTAL]).toBeUndefined();
    // Capability booleans are always present (false when absent), not omitted.
    expect(a[ATTR_CLIENT_CAP_ELICITATION_FORM]).toBe(false);
    expect(a[ATTR_CLIENT_VERSION_MAJOR]).toBe("0");
  });

  it("falls back to 'unknown' when clientInfo is absent", () => {
    recordClientConnection(stub(undefined, undefined), { transport: "stdio" });
    const a = telemetry.spansNamed(CONNECT_SPAN)[0]!.attributes;
    expect(a[ATTR_CLIENT_NAME]).toBe("unknown");
    expect(a[ATTR_CLIENT_VERSION]).toBe("unknown");
  });

  it("increments the census counter with the low-cardinality slice only", async () => {
    // A distinct client name keeps this datapoint separable under the cumulative reader.
    const server = stub({ name: "census-probe", version: "3.1.0" }, {});
    recordClientConnection(server, { transport: "http" });

    const points = await telemetry.sumPoints("mcp_paprika.client.connections", {
      [ATTR_CLIENT_NAME]: "census-probe",
    });
    expect(points).toHaveLength(1);
    expect(points[0]!.value).toBe(1);
    // Only name + major + transport label the counter — never the full version.
    expect(points[0]!.attributes[ATTR_CLIENT_VERSION_MAJOR]).toBe("3");
    expect(points[0]!.attributes[ATTR_MCP_PAPRIKA_TRANSPORT]).toBe("http");
    expect(points[0]!.attributes[ATTR_CLIENT_VERSION]).toBeUndefined();
  });

  it("stashes the fingerprint so the tool wrapper can tag spans by client", () => {
    const server = stub({ name: "Cursor", version: "2.0.1" }, { sampling: {} });
    recordClientConnection(server, { transport: "stdio", protocolVersion: "2025-03-26" });

    // clientAttrs: the low-cardinality slice the tool wrapper spreads onto spans.
    expect(clientAttrs(server)).toEqual({
      [ATTR_CLIENT_NAME]: "Cursor",
      [ATTR_CLIENT_VERSION_MAJOR]: "2",
      [ATTR_MCP_PAPRIKA_TRANSPORT]: "stdio",
    });
    // clientFingerprint: the full object the disconnect log reads — capabilities is
    // the RAW tree, logged verbatim (here the parsed fallback, since no rawCapabilities).
    expect(clientFingerprint(server)).toMatchObject({
      name: "Cursor",
      version: "2.0.1",
      protocolVersion: "2025-03-26",
      capabilities: { sampling: {} },
    });
  });

  it("returns empty attrs for a server with no recorded connection", () => {
    expect(clientAttrs(stub({ name: "x", version: "1" }, {}))).toEqual({});
    expect(clientFingerprint(stub({ name: "x", version: "1" }, {}))).toBeUndefined();
  });

  it("is idempotent per server — a re-sent initialized notification does not double-count", async () => {
    const server = stub({ name: "idem-probe", version: "1.0.0" }, {});
    recordClientConnection(server, { transport: "stdio" });
    recordClientConnection(server, { transport: "stdio" });

    const points = await telemetry.sumPoints("mcp_paprika.client.connections", {
      [ATTR_CLIENT_NAME]: "idem-probe",
    });
    expect(points).toHaveLength(1);
    expect(points[0]!.value).toBe(1);
    expect(
      telemetry.spansNamed(CONNECT_SPAN).filter((s) => s.attributes[ATTR_CLIENT_NAME] === "idem-probe"),
    ).toHaveLength(1);
  });

  it("length-caps the client name used as a metric label", () => {
    const longName = "x".repeat(200);
    recordClientConnection(stub({ name: longName, version: "1.0.0" }, {}), { transport: "stdio" });

    // clientAttrs is the census slice the counter + tool spans carry — capped.
    const server2 = stub({ name: longName, version: "1.0.0" }, {});
    recordClientConnection(server2, { transport: "stdio" });
    const name = clientAttrs(server2)[ATTR_CLIENT_NAME] as string;
    expect(name.length).toBe(64);
    expect(longName.startsWith(name)).toBe(true);
  });
});

describe("sessionAttrs / recordSessionId", () => {
  it("returns the stashed session id under mcp.session.id once recorded", () => {
    const server = stub({ name: "claude-ai", version: "1.0.0" }, {});
    expect(sessionAttrs(server)).toEqual({});
    recordSessionId(server, "sess-123");
    expect(sessionAttrs(server)).toEqual({ [ATTR_MCP_SESSION_ID]: "sess-123" });
  });

  it("is first-write-wins (a re-init cannot overwrite the live session id)", () => {
    const server = stub({ name: "claude-ai", version: "1.0.0" }, {});
    recordSessionId(server, "first");
    recordSessionId(server, "second");
    expect(sessionAttrs(server)).toEqual({ [ATTR_MCP_SESSION_ID]: "first" });
  });

  it("returns an empty object for an un-recorded server (stdio / pre-init)", () => {
    expect(sessionAttrs(stub({ name: "x", version: "1" }, {}))).toEqual({});
  });
});
