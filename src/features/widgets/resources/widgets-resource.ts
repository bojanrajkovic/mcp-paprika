import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { WidgetsState } from "../module.js";

import { UI_RESOURCE_MIME_TYPE } from "../../../shared/mcp-app.js";
import { resourceNotFound, tracedResourceRead } from "../../../shared/resources.js";

/**
 * `ui://widget/{name}` — serve a prebuilt, self-contained widget HTML for a host
 * to render in a sandboxed iframe (ADR-0019). A widget-bearing tool references
 * its view by this exact URI through `ToolSpec.ui.resourceUri`; the host fetches
 * it here and feeds the tool's result in.
 *
 * The HTML was loaded once at module construction into `ctx.state.widgets`, so
 * both the `list` and the read are pure in-memory lookups — the read never
 * touches disk, and the list enumerates the built-artifact map rather than
 * scanning the directory per request.
 */
export function widgetsResource(ctx: DomainCtx<WidgetsState, never>): void {
  const template = new ResourceTemplate("ui://widget/{name}", {
    list: async () => ({
      resources: [...ctx.state.widgets.keys()].map((name) => ({
        uri: `ui://widget/${name}`,
        name: `${name} widget`,
        mimeType: UI_RESOURCE_MIME_TYPE,
      })),
    }),
  });

  ctx.server.registerResource(
    "widgets",
    template,
    { description: "Interactive widget views, rendered by hosts that support the MCP apps surface (ADR-0019)" },
    tracedResourceRead("widgets", async (uri, variables) => {
      const name = variables["name"] as string;
      const html = ctx.state.widgets.get(name);
      if (html === undefined) {
        resourceNotFound(`Widget not found: ${name}`);
      }
      // Inject server capabilities as a classic <script> so the widget can read
      // them from window.__MCP_SERVER_CAPS__ before the module bundle runs. Done
      // here (per resource-read, not at artifact-load time) so each client gets
      // capabilities reflecting its own negotiated session.
      const caps = ctx.server.server.getClientCapabilities();
      const serverCaps = JSON.stringify({
        supportsElicitation: caps?.elicitation?.form !== undefined,
      });
      const injected = html.replace(
        "<body>",
        () => `<body>\n    <script>window.__MCP_SERVER_CAPS__=${serverCaps};</script>`,
      );
      return {
        contents: [{ uri: uri.href, mimeType: UI_RESOURCE_MIME_TYPE, text: injected }],
      };
    }),
  );
}
