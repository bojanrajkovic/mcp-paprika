import { context, defaultTextMapSetter } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

import type { WidgetsState } from "../module.js";

import { defineResource } from "../../../kernel/resource.js";
import { supportsForm } from "../../../shared/elicit.js";
import { UI_RESOURCE_MIME_TYPE } from "../../../shared/mcp-app.js";
import { resourceNotFound } from "../../../shared/resources.js";
import { SERVER_CAPS_KEY, TRACEPARENT_KEY, WIDGET_INJECT_SLOT } from "../shared/server-caps-key.js";

/**
 * Explicit W3C propagator — the GLOBAL propagator is `OTEL_PROPAGATORS=none` (so
 * `propagation.inject` no-ops), and this serializes the active span's context regardless.
 * Pure object, no MeterProvider/late-binding hazard, so module scope is safe (unlike instruments).
 */
const traceparentPropagator = new W3CTraceContextPropagator();

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
export const widgetsResource = defineResource<WidgetsState, never>(
  {
    primary: {
      name: "widgets",
      uriTemplate: "ui://widget/{name}",
      description: "Interactive widget views, rendered by hosts that support the MCP apps surface (ADR-0019)",
    },
  },
  (ctx) => ({
    list: async () => ({
      resources: [...ctx.state.widgets.keys()].map((name) => ({
        uri: `ui://widget/${name}`,
        name: `${name} widget`,
        mimeType: UI_RESOURCE_MIME_TYPE,
      })),
    }),
    read: async (uri, variables) => {
      const name = variables["name"] as string;
      const html = ctx.state.widgets.get(name);
      if (html === undefined) {
        resourceNotFound(`Widget not found: ${name}`);
      }
      // Inject server capabilities as a classic <script> so the widget can read
      // them from window[SERVER_CAPS_KEY] before the module bundle runs. Done
      // here (per resource-read, not at artifact-load time) so each client gets
      // capabilities reflecting its own negotiated session.
      const serverCaps = JSON.stringify({
        supportsElicitation: supportsForm(ctx.server.server),
      });
      // Smuggle the active resources/read span's W3C traceparent into the same <script>, so the
      // widget can report its render-timing marks back as child spans of THIS read (0b). An
      // absent or non-recording span yields no carrier entry → the key is omitted and the widget
      // simply doesn't report. JSON.stringify quotes the value safely (it is our own hex id).
      const carrier: Record<string, string> = {};
      traceparentPropagator.inject(context.active(), carrier, defaultTextMapSetter);
      const traceparent = carrier["traceparent"];
      const injectScript =
        `window["${SERVER_CAPS_KEY}"]=${serverCaps};` +
        (traceparent !== undefined ? `window["${TRACEPARENT_KEY}"]=${JSON.stringify(traceparent)};` : "");
      const injected = html.replace(WIDGET_INJECT_SLOT, `<script>${injectScript}</script>`);
      return {
        contents: [{ uri: uri.href, mimeType: UI_RESOURCE_MIME_TYPE, text: injected }],
      };
    },
  }),
);
