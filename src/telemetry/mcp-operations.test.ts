import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { EmptyResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { afterEach, describe, expect, it } from "vitest";

import { installTestTelemetry } from "../../test/support/telemetry-test-utils.js";
import { buildBrandedServer } from "../server/build.js";
import { OTHER_METHOD, recordMcpOperations } from "./mcp-operations.js";

// Module scope, before any recording — see the helper's doc-comment.
const telemetry = installTestTelemetry();
const METRIC = "mcp.server.operation.duration";

/** Points are cumulative across tests, so assertions compare counts before and after. */
async function count(attrs: Record<string, unknown>): Promise<number> {
  const points = await telemetry.histogramPoints(METRIC, attrs);
  return points.reduce((sum, point) => sum + point.value.count, 0);
}

let cleanup: () => Promise<void> = () => Promise.resolve();
afterEach(() => cleanup());

async function connect() {
  const server = buildBrandedServer();
  server.registerTool("echo", { description: "Echo." }, () => ({ content: [] }));
  server.registerResource("thing", "thing://one", {}, () => ({ contents: [] }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  recordMcpOperations(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  cleanup = async () => {
    await client.close();
    await server.close();
  };
  return { client, clientTransport };
}

describe("recordMcpOperations", () => {
  it("records the handshake's request and notification once each", async () => {
    const before = await count({ "mcp.method.name": "initialize" });
    const beforeNotification = await count({ "mcp.method.name": "notifications/initialized" });

    await connect();
    // The initialized notification is delivered on a later tick than connect resolves.
    await new Promise((resolve) => setImmediate(resolve));

    expect(await count({ "mcp.method.name": "initialize" })).toBe(before + 1);
    expect(await count({ "mcp.method.name": "notifications/initialized" })).toBe(beforeNotification + 1);
  });

  it.each([
    ["tools/list", (c: Client) => c.listTools()],
    ["resources/list", (c: Client) => c.listResources()],
    ["ping", (c: Client) => c.ping()],
  ])("records one %s data point with no error attributes", async (method, call) => {
    const { client } = await connect();
    const before = await count({ "mcp.method.name": method });

    await call(client);

    expect(await count({ "mcp.method.name": method })).toBe(before + 1);
    const points = await telemetry.histogramPoints(METRIC, { "mcp.method.name": method });
    expect(points[0]?.attributes).toEqual({ "mcp.method.name": method });
  });

  it("leaves tools/call and resources/read to their chokepoints", async () => {
    const { client } = await connect();

    await client.callTool({ name: "echo" });
    await client.readResource({ uri: "thing://one" });

    expect(await count({ "mcp.method.name": "tools/call" })).toBe(0);
    expect(await count({ "mcp.method.name": "resources/read" })).toBe(0);
  });

  it("labels a JSON-RPC error with its code", async () => {
    const { client } = await connect();
    const attrs = {
      "mcp.method.name": "server/discover",
      "error.type": "MethodNotFound",
      "rpc.response.status_code": "-32601",
    };
    const before = await count(attrs);

    await expect(client.request({ method: "server/discover" }, EmptyResultSchema)).rejects.toThrow();

    expect(await count(attrs)).toBe(before + 1);
  });

  it("never puts an unknown client-supplied method name on a metric", async () => {
    const { client } = await connect();
    const before = await count({ "mcp.method.name": OTHER_METHOD });

    await expect(client.request({ method: "someone's secret text" }, EmptyResultSchema)).rejects.toThrow();

    expect(await count({ "mcp.method.name": OTHER_METHOD })).toBe(before + 1);
    expect(await count({ "mcp.method.name": "someone's secret text" })).toBe(0);
  });

  it("records nothing for a request cancelled before its response", async () => {
    const { client } = await connect();
    const before = await count({ "mcp.method.name": "tools/list" });

    const controller = new AbortController();
    const listing = client.listTools(undefined, { signal: controller.signal });
    controller.abort();
    await expect(listing).rejects.toThrow();
    await new Promise((resolve) => setImmediate(resolve));

    expect(await count({ "mcp.method.name": "tools/list" })).toBe(before);
  });
});
