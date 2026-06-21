import type {
  App,
  applyDocumentTheme,
  applyHostFonts,
  applyHostStyleVariables,
  getDocumentTheme,
} from "@modelcontextprotocol/ext-apps";
import { Hono } from "hono";
import type { Logger } from "pino";

import { loadWidgetArtifacts, widgetsDir } from "../features/widgets/artifacts.js";
import { SERVER_CAPS_KEY, WIDGET_INJECT_SLOT } from "../features/widgets/shared/server-caps-key.js";

/**
 * A dev-only Hono router serving
 * `GET /widget-preview?widget=<name>&payload=<json>&theme=<light|dark>&userAgent=<host>&elicitation=<0|1>`:
 * a built widget rendered in a plain browser tab with a FAKE host shim, so widget
 * UI can be iterated with ordinary devtools, no real MCP host required. `theme` and
 * `userAgent` drive the shim's `getHostContext()`, so the host-matched theme and
 * typeface (a serif-first host renders the serif stack) can be previewed too.
 * `elicitation=1` sets `window.__MCP_SERVER_CAPS__.supportsElicitation=true` in the
 * shim constructor, mirroring what `widgets-resource.ts` injects at `resources/read`
 * time so the elicitation-aware confirm path can be exercised without a real MCP host.
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
  const dir = opts.dir ?? widgetsDir();

  app.get("/widget-preview", async (c) => {
    const payload = c.req.query("payload");
    if (payload !== undefined && Buffer.byteLength(payload, "utf8") > MAX_PAYLOAD_BYTES) {
      return c.text(`payload too large (max ${MAX_PAYLOAD_BYTES.toString()} bytes)`, 413);
    }

    // Load PER REQUEST, not once at construction: this route exists for iteration
    // with `pnpm dev:widgets` (which rebuilds on change), so a browser refresh must
    // pick up the latest `dist/widgets/*.html` without a server restart. It is
    // dev-only and not hot, so re-reading the dir each request is fine.
    const widgets = await loadWidgetArtifacts(dir, log);
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
    // it claims `globalThis.ExtApps` first and the real (`??=`) runtime no-ops. A
    // function replacement is used so a `$` in the shim is never treated as a
    // String.replace substitution pattern ($&, $1, …).
    return c.html(html.replace(WIDGET_INJECT_SLOT, `<script>${PREVIEW_SHIM}</script>`));
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

/** Top-level `globalThis.ExtApps` helpers {@link previewShim} fakes alongside the `App` class.
 * `satisfies` pins each name against the installed ext-apps module exports so a rename there is a
 * compile error here. `host-style.ts` calls `applyHostStyleVariables` / `applyHostFonts` via this
 * seam; dropping one from the shim would leave them calling undefined silently.
 */
type ExtAppsHelperShape = {
  applyHostStyleVariables: typeof applyHostStyleVariables;
  applyHostFonts: typeof applyHostFonts;
  applyDocumentTheme: typeof applyDocumentTheme;
  getDocumentTheme: typeof getDocumentTheme;
};
export const SHIMMED_EXTAPPS_HELPERS = [
  "applyHostStyleVariables",
  "applyHostFonts",
  "applyDocumentTheme",
  "getDocumentTheme",
] as const satisfies readonly (keyof ExtAppsHelperShape)[];

/**
 * The fake `globalThis.ExtApps` injected into a previewed widget. Its `App` constructor
 * reads `?elicitation=` and sets `window.__MCP_SERVER_CAPS__` (mirroring the injection
 * `widgets-resource.ts` does at `resources/read` time), then reads `?payload=` for the
 * `connect()` feed to `ontoolresult`. Its `getHostContext()` reflects `?theme=` (light|dark)
 * and `?userAgent=`; every other host method is a harmless no-op. Authored as a string
 * because it runs in the browser, not Node; {@link SHIMMED_HOST_METHODS} keeps its surface
 * honest against ext-apps.
 */
const PREVIEW_SHIM = `globalThis.ExtApps = {
  applyHostStyleVariables() {},
  applyHostFonts() {},
  applyDocumentTheme() {},
  getDocumentTheme() {
    try { return new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light"; }
    catch { return "light"; }
  },
  App: class {
    ontoolresult;
    ontoolinput;
    onhostcontextchanged;
    #payload;
    constructor() {
      try {
        const q = new URLSearchParams(location.search);
        window["${SERVER_CAPS_KEY}"] = { supportsElicitation: q.get("elicitation") === "1" };
        this.#payload = q.get("payload");
      } catch { this.#payload = null; }
    }
    async connect() {
      if (this.#payload === null || this.#payload === undefined) return;
      let structuredContent;
      try {
        const parsed = JSON.parse(this.#payload);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) structuredContent = parsed;
      } catch {}
      this.ontoolresult && this.ontoolresult({ content: [{ type: "text", text: this.#payload }], structuredContent });
    }
    getHostContext() {
      let theme = "light", userAgent;
      try {
        const q = new URLSearchParams(location.search);
        if (q.get("theme") === "dark") theme = "dark";
        userAgent = q.get("userAgent") ?? undefined;
      } catch {}
      return userAgent ? { theme, userAgent } : { theme };
    }
    sendMessage(message) { console.log("[widget-preview] sendMessage", message); return Promise.resolve({}); }
    updateModelContext() { return Promise.resolve({}); }
    callServerTool() { return Promise.resolve({ content: [] }); }
    openLink(args) { console.log("[widget-preview] openLink", args); return Promise.resolve({}); }
    downloadFile() { return Promise.resolve({}); }
  },
};`;
