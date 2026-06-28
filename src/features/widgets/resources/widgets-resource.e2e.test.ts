/**
 * Advertised-surface e2e for the `ui://widget/{name}` resource: registers it on a
 * real {@link buildBrandedServer} and reads it back over the SDK's in-memory
 * transport, so it anchors the contract a host relies on — a known widget's HTML
 * is served under the apps MIME type, the build-artifact map is enumerated in
 * `resources/list`, and an unknown name answers a protocol not-found.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { beforeEach, describe, expect, it } from "vitest";

import type { DomainCtx, Infra } from "../../../kernel/registry.js";
import type { VendorImportMap } from "../artifacts.js";
import type { WidgetsState } from "../module.js";

import { connectInMemoryMcp } from "../../../../test/support/in-memory-mcp.js";
import { installTestTelemetry } from "../../../../test/support/telemetry-test-utils.js";
import { buildBrandedServer } from "../../../server/build.js";
import { UI_RESOURCE_MIME_TYPE } from "../../../shared/mcp-app.js";
import { SILENT_LOG } from "../../../utils/log.js";
import { SERVER_CAPS_KEY, TRACEPARENT_KEY } from "../shared/server-caps-key.js";
import { widgetsResource } from "./widgets-resource.js";

// A recording span provider so the resources/read span has a valid context to inject.
const telemetry = installTestTelemetry();
beforeEach(() => telemetry.spanExporter.reset());

function makeCtx(
  server: McpServer,
  widgets: ReadonlyMap<string, string>,
  vendor: VendorImportMap | null = null,
): DomainCtx<WidgetsState, never> {
  return { state: { widgets, vendor }, writes: {}, deps: {}, infra: { log: SILENT_LOG } as unknown as Infra, server };
}

describe("widgetsResource — ui://widget/{name}", () => {
  it("serves a known widget's HTML under the apps MIME type", async () => {
    const server = buildBrandedServer();
    widgetsResource.register(
      makeCtx(server, new Map([["demo", "<html><body><!-- __widget-inject__ -->demo widget</body></html>"]])),
    );

    const mcp = await connectInMemoryMcp(server);
    try {
      const result = await mcp.client.readResource({ uri: "ui://widget/demo" });
      expect(result.contents).toHaveLength(1);
      expect(result.contents[0]).toMatchObject({ uri: "ui://widget/demo", mimeType: UI_RESOURCE_MIME_TYPE });
      // The resource handler injects window[SERVER_CAPS_KEY] at read time; the
      // original HTML is embedded but the returned text is not a verbatim copy.
      const content = result.contents[0];
      const text = content !== undefined && "text" in content ? content.text : undefined;
      expect(text).toContain("demo widget");
      expect(text).toContain(SERVER_CAPS_KEY);
    } finally {
      await mcp.close();
    }
  });

  it("smuggles the resources/read span's W3C traceparent into the served HTML", async () => {
    const server = buildBrandedServer();
    widgetsResource.register(
      makeCtx(server, new Map([["demo", "<html><body><!-- __widget-inject__ -->demo widget</body></html>"]])),
    );

    const mcp = await connectInMemoryMcp(server);
    try {
      const result = await mcp.client.readResource({ uri: "ui://widget/demo" });
      const content = result.contents[0];
      const text = content !== undefined && "text" in content ? (content.text as string) : "";
      // The injected traceparent must be THIS read's span context, not just any well-formed value —
      // so the widget's reported marks re-parent under the read that served them. Pin trace + span id.
      const readSpan = telemetry.spansNamed("resources/read")[0];
      expect(readSpan).toBeDefined();
      const sc = readSpan!.spanContext();
      expect(text).toContain(`window["${TRACEPARENT_KEY}"]="00-${sc.traceId}-${sc.spanId}-`);
    } finally {
      await mcp.close();
    }
  });

  it("injects the vendor import map and emits _meta.ui.csp when externalized (HTTP)", async () => {
    const server = buildBrandedServer();
    const vendor: VendorImportMap = {
      importMap:
        '<script type="importmap">{"imports":{"@modelcontextprotocol/ext-apps":"https://host.example/widgets/vendor-abc.js"}}</script>',
      csp: { resourceDomains: ["https://host.example"] },
    };
    widgetsResource.register(
      makeCtx(
        server,
        new Map([["demo", "<html><body><!-- __widget-inject__ --><!-- __widget-vendor__ -->demo</body></html>"]]),
        vendor,
      ),
    );

    const mcp = await connectInMemoryMcp(server);
    try {
      const result = await mcp.client.readResource({ uri: "ui://widget/demo" });
      const content = result.contents[0];
      const text = content !== undefined && "text" in content ? (content.text as string) : "";
      // The vendor slot is filled with the import map that resolves the externalized ext-apps runtime.
      expect(text).toContain('<script type="importmap">');
      expect(text).toContain("https://host.example/widgets/vendor-abc.js");
      // And the served content item carries _meta.ui.csp so the host allowlists the vendor origin.
      expect(content?._meta).toEqual({ ui: { csp: { resourceDomains: ["https://host.example"] } } });
    } finally {
      await mcp.close();
    }
  });

  it("enumerates the in-memory artifact map in resources/list", async () => {
    const server = buildBrandedServer();
    widgetsResource.register(makeCtx(server, new Map([["demo", "<html>a</html>"]])));

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
    widgetsResource.register(makeCtx(server, new Map()));

    const mcp = await connectInMemoryMcp(server);
    try {
      await expect(mcp.client.readResource({ uri: "ui://widget/missing" })).rejects.toThrow(/not found/i);
    } finally {
      await mcp.close();
    }
  });
});
