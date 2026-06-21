/**
 * Advertised-surface e2e for the `ui://widget/{name}` resource: registers it on a
 * real {@link buildBrandedServer} and reads it back over the SDK's in-memory
 * transport, so it anchors the contract a host relies on — a known widget's HTML
 * is served under the apps MIME type, the build-artifact map is enumerated in
 * `resources/list`, and an unknown name answers a protocol not-found.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";

import type { DomainCtx, Infra } from "../../../kernel/registry.js";
import type { WidgetsState } from "../module.js";

import { connectInMemoryMcp } from "../../../../test/support/in-memory-mcp.js";
import { buildBrandedServer } from "../../../server/build.js";
import { UI_RESOURCE_MIME_TYPE } from "../../../shared/mcp-app.js";
import { SILENT_LOG } from "../../../utils/log.js";
import { widgetsResource } from "./widgets-resource.js";

function makeCtx(server: McpServer, widgets: ReadonlyMap<string, string>): DomainCtx<WidgetsState, never> {
  return { state: { widgets }, writes: {}, deps: {}, infra: { log: SILENT_LOG } as unknown as Infra, server };
}

describe("widgetsResource — ui://widget/{name}", () => {
  it("serves a known widget's HTML under the apps MIME type", async () => {
    const server = buildBrandedServer();
    widgetsResource(makeCtx(server, new Map([["demo", "<html><body>demo widget</body></html>"]])));

    const mcp = await connectInMemoryMcp(server);
    try {
      const result = await mcp.client.readResource({ uri: "ui://widget/demo" });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({ uri: "ui://widget/demo", mimeType: UI_RESOURCE_MIME_TYPE });
      // The resource handler injects window.__MCP_SERVER_CAPS__ at read time; the
      // original HTML is embedded but the returned text is not a verbatim copy.
      const text = "text" in result.contents[0]! ? result.contents[0].text : undefined;
      expect(text).toContain("demo widget");
      expect(text).toContain("__MCP_SERVER_CAPS__");
    } finally {
      await mcp.close();
    }
  });

  it("enumerates the in-memory artifact map in resources/list", async () => {
    const server = buildBrandedServer();
    widgetsResource(makeCtx(server, new Map([["demo", "<html>a</html>"]])));

    const mcp = await connectInMemoryMcp(server);
    try {
      const { resources } = await mcp.client.listResources();
      const advertised = resources.find((r) => r.uri === "ui://widget/demo");
      expect(advertised).toBeDefined();
      expect(advertised?.mimeType).toBe(UI_RESOURCE_MIME_TYPE);
    } finally {
      await mcp.close();
    }
  });

  it("answers a not-found error for an unknown widget", async () => {
    const server = buildBrandedServer();
    widgetsResource(makeCtx(server, new Map()));

    const mcp = await connectInMemoryMcp(server);
    try {
      await expect(mcp.client.readResource({ uri: "ui://widget/missing" })).rejects.toThrow(/not found/i);
    } finally {
      await mcp.close();
    }
  });
});
