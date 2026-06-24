import type { ClientCapabilities, Implementation } from "@modelcontextprotocol/sdk/types.js";
import { beforeEach, describe, expect, it } from "vitest";

import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import {
  ATTR_CLIENT_CAP_ELICITATION,
  ATTR_CLIENT_CAP_ELICITATION_FORM,
  ATTR_CLIENT_CAP_EXPERIMENTAL,
  ATTR_CLIENT_CAP_ROOTS,
  ATTR_CLIENT_CAP_SAMPLING,
  ATTR_CLIENT_NAME,
  ATTR_CLIENT_PROTOCOL_VERSION,
  ATTR_CLIENT_TITLE,
  ATTR_CLIENT_VERSION,
  ATTR_CLIENT_VERSION_MAJOR,
  clientAttrs,
  clientFingerprint,
  type FingerprintServer,
  recordClientConnection,
} from "./client-fingerprint.js";
import { ATTR_MCP_PAPRIKA_TRANSPORT } from "./instruments.js";

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
    // clientFingerprint: the full object the disconnect log reads.
    expect(clientFingerprint(server)).toMatchObject({
      name: "Cursor",
      version: "2.0.1",
      protocolVersion: "2025-03-26",
      capabilities: { sampling: true, roots: false },
    });
  });

  it("returns empty attrs for a server with no recorded connection", () => {
    expect(clientAttrs(stub({ name: "x", version: "1" }, {}))).toEqual({});
    expect(clientFingerprint(stub({ name: "x", version: "1" }, {}))).toBeUndefined();
  });
});
