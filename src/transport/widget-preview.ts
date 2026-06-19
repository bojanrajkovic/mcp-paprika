import type { App } from "@modelcontextprotocol/ext-apps";
import { Hono } from "hono";
import type { Logger } from "pino";

import { loadWidgetArtifacts, widgetsDir } from "../features/widgets/artifacts.js";

/**
 * A dev-only Hono router serving `GET /widget-preview?widget=<name>&payload=<json>`:
 * a built widget rendered in a plain browser tab with a FAKE host shim, so widget
 * UI can be iterated with ordinary devtools, no real MCP host required.
 *
 * Mount it ONLY behind the `MCP_WIDGET_PREVIEW` flag (it does not exist in
 * production) and, like the favicon, BEFORE the `/mcp` bearer guard (it is
 * unauthenticated). It serves the same self-contained HTML the `ui://` resource
 * does, with one substitution: a classic `<script>` injected ahead of the module
 * bundle installs {@link previewShim} as `globalThis.ExtApps`. The build inlines
 * the real ext-apps runtime with `??=`, so the shim — set first by the classic
 * script — wins; without it the real runtime would `postMessage` a host that
 * isn't there and hang on "Connecting…".
 *
 * `?payload=` is untrusted, but the server never reflects it: the shim reads it
 * CLIENT-SIDE from `location.search` and feeds it to the widget's `ontoolresult`,
 * where the widget JSON-parses it under its own try/catch. So there is no
 * server-side HTML reflection (no reflected-XSS surface); the server only
 * size-bounds the query as defense-in-depth.
 */
export function buildWidgetPreviewRouter(log: Logger, opts: { readonly dir?: string } = {}): Hono {
  const app = new Hono();
  // Load the built widgets once at construction (degrades to empty if unbuilt).
  // `opts.dir` overrides the resolved `dist/widgets` for tests.
  const widgetsPromise = loadWidgetArtifacts(opts.dir ?? widgetsDir(), log);

  app.get("/widget-preview", async (c) => {
    const payload = c.req.query("payload");
    if (payload !== undefined && payload.length > MAX_PAYLOAD_BYTES) {
      return c.text(`payload too large (max ${MAX_PAYLOAD_BYTES.toString()} bytes)`, 413);
    }

    const widgets = await widgetsPromise;
    const available = [...widgets.keys()].join(", ") || "(none — run `pnpm build:widgets`)";

    const name = c.req.query("widget");
    if (name === undefined) {
      return c.text(`Specify ?widget=<name>. Available widgets: ${available}`, 400);
    }
    const html = widgets.get(name);
    if (html === undefined) {
      return c.text(`Unknown widget "${name}". Available widgets: ${available}`, 404);
    }

    // Inject the shim as a classic <script> before the deferred module bundle, so
    // it claims `globalThis.ExtApps` first and the real (`??=`) runtime no-ops.
    return c.html(html.replace("<body>", `<body>\n    <script>${PREVIEW_SHIM}</script>`));
  });

  return app;
}

/** Cap on the `?payload=` query (defense-in-depth; the shim reads it client-side). */
const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Host `App` members {@link previewShim} fakes. `satisfies readonly (keyof App)[]`
 * pins each name against the INSTALLED ext-apps `App` type: if the package renames
 * or removes one, this fails to compile and the shim is updated in lockstep. It
 * pins the TYPE surface only — a same-signature behavior change in ext-apps still
 * passes (the shim is a dev convenience, not a conformance oracle). A unit test
 * pins the shim STRING against this list so a method dropped from the shim is
 * caught too.
 */
export const SHIMMED_HOST_METHODS = [
  "ontoolresult",
  "onhostcontextchanged",
  "connect",
  "getHostContext",
  "sendMessage",
  "updateModelContext",
  "callServerTool",
  "openLink",
  "downloadFile",
] as const satisfies readonly (keyof App)[];

/**
 * The fake `globalThis.ExtApps` injected into a previewed widget. Its `App` reads
 * `?payload=` from `location.search` and feeds it to `ontoolresult` on `connect()`;
 * every other host method is a harmless no-op. Authored as a string because it
 * runs in the browser, not Node; {@link SHIMMED_HOST_METHODS} keeps its surface
 * honest against ext-apps.
 */
const PREVIEW_SHIM = `globalThis.ExtApps = {
  applyHostStyleVariables() {},
  applyDocumentTheme() {},
  getDocumentTheme() { return "light"; },
  App: class {
    ontoolresult;
    ontoolinput;
    onhostcontextchanged;
    #payload;
    constructor() {
      try { this.#payload = new URLSearchParams(location.search).get("payload"); }
      catch { this.#payload = null; }
    }
    async connect() {
      if (this.#payload !== null && this.#payload !== undefined) {
        this.ontoolresult && this.ontoolresult({ content: [{ type: "text", text: this.#payload }] });
      }
    }
    getHostContext() { return { theme: "light" }; }
    sendMessage(message) { console.log("[widget-preview] sendMessage", message); return Promise.resolve({}); }
    updateModelContext() { return Promise.resolve({}); }
    callServerTool() { return Promise.resolve({ content: [] }); }
    openLink(args) { console.log("[widget-preview] openLink", args); return Promise.resolve({}); }
    downloadFile() { return Promise.resolve({}); }
  },
};`;
