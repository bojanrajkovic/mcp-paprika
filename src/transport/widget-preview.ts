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
import { SERVER_CAPS_KEY, WIDGET_INJECT_SLOT, WIDGET_VENDOR_SLOT } from "../features/widgets/shared/server-caps-key.js";

/**
 * A dev-only Hono router serving
 * `GET /widget-preview?widget=<name>&payload=<json>&theme=<light|dark>&userAgent=<host>&elicitation=<0|1>&touch=<0|1>&scale=<n>`:
 * a built widget rendered in a plain browser tab with a FAKE host shim, so widget
 * UI can be iterated with ordinary devtools, no real MCP host required. `theme` and
 * `userAgent` drive the shim's `getHostContext()`, so the host-matched theme and
 * typeface (a serif-first host renders the serif stack) can be previewed too.
 * `elicitation=1` sets `window.__MCP_SERVER_CAPS__.supportsElicitation=true` in the
 * shim constructor, mirroring what `widgets-resource.ts` injects at `resources/read`
 * time so the elicitation-aware confirm path can be exercised without a real MCP host.
 * `touch=1` sets `getHostContext().deviceCapabilities.touch = true`, so a touch-only
 * affordance (pantry's swipe-to-remove, grocery's swipe-to-mark) can be exercised
 * without a real touch host — `matchMedia("(pointer: coarse)")` alone doesn't flip
 * true under plain viewport-resize emulation. `scale=<n>` (n > 1) repeats a small
 * base payload's `items` array n times (unique-suffixed uids), entirely CLIENT-SIDE
 * in the shim's `connect()` — so a very-large-list stress test never has to encode
 * hundreds of items into the URL, which trips Node's raw HTTP header-size limit
 * (a 431) well before this route's own 64 KB `?payload=` guard ever runs.
 *
 * Mount it ONLY behind the `MCP_WIDGET_PREVIEW` flag (it does not exist in
 * production) and, like the favicon, BEFORE the `/mcp` bearer guard (it is
 * unauthenticated). It serves the same HTML the `ui://` resource does, with one
 * substitution: instead of the real ext-apps runtime, the vendor slot gets an
 * `<script type="importmap">` resolving `@modelcontextprotocol/ext-apps` to a
 * `data:` URL of the FAKE-host shim module ({@link PREVIEW_SHIM_MODULE}), so the
 * widget's `import { App }` binds to the shim (ADR-0025). Without it the widget
 * would import a runtime that `postMessage`s a host that isn't there and hang on
 * "Connecting…".
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

    // Resolve the widget's `@modelcontextprotocol/ext-apps` import to the shim module via the vendor
    // slot's import map; the caps inject slot is unused (the shim's App constructor sets the caps).
    // Function replacement so a `$` in the import map is never treated as a String.replace
    // substitution pattern ($&, $1, …) — base64 has none, but the guard is free.
    return c.html(html.replace(WIDGET_INJECT_SLOT, "").replace(WIDGET_VENDOR_SLOT, () => PREVIEW_IMPORTMAP));
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
 * The fake ext-apps runtime served (as a `data:` URL ES module) to a previewed widget, so its
 * `import { App, applyHostStyleVariables, … }` binds to these fakes. The `App` constructor reads
 * `?elicitation=` and sets `window.__MCP_SERVER_CAPS__` (mirroring the injection `widgets-resource.ts`
 * does at `resources/read` time), then reads `?payload=` for the `connect()` feed to `ontoolresult`.
 * Its `getHostContext()` reflects `?theme=` (light|dark) and `?userAgent=`; every other host method
 * is a harmless no-op. Authored as a string because it runs in the browser, not Node; the export
 * surface is pinned against ext-apps by {@link SHIMMED_HOST_METHODS} / {@link SHIMMED_EXTAPPS_HELPERS}.
 */
const PREVIEW_SHIM_MODULE = `
export function applyHostStyleVariables() {}
export function applyHostFonts() {}
export function applyDocumentTheme() {}
export function getDocumentTheme() {
  try { return new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}
export class App {
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
    try {
      const scale = Number(new URLSearchParams(location.search).get("scale"));
      if (structuredContent && Array.isArray(structuredContent.items) && scale > 1) {
        const base = structuredContent.items;
        const scaled = [];
        for (let copy = 0; copy < scale; copy++) {
          for (const item of base) scaled.push({ ...item, uid: item.uid + "-" + copy });
        }
        structuredContent = { ...structuredContent, items: scaled };
      }
    } catch {}
    this.ontoolresult && this.ontoolresult({ content: [{ type: "text", text: this.#payload }], structuredContent });
  }
  getHostContext() {
    let theme = "light", userAgent, deviceCapabilities;
    try {
      const q = new URLSearchParams(location.search);
      if (q.get("theme") === "dark") theme = "dark";
      userAgent = q.get("userAgent") ?? undefined;
      if (q.get("touch") === "1") deviceCapabilities = { touch: true };
    } catch {}
    return { theme, ...(userAgent ? { userAgent } : {}), ...(deviceCapabilities ? { deviceCapabilities } : {}) };
  }
  sendMessage(message) { console.log("[widget-preview] sendMessage", message); return Promise.resolve({}); }
  updateModelContext() { return Promise.resolve({}); }
  callServerTool(req) {
    // read_recipe is answered with a canned detail so the browse -> detail swap (and its View
    // Transition) is exercisable offline. name/servings/time are pulled from the matching browse
    // item WHEN the payload keys rows by recipe uid (the recipe-browser's shape) so the detail
    // matches the tapped row; the menu (keyed by menu-item uid) and meal-week (no items array)
    // fall through to the generic Sample Recipe defaults. ingredients/directions are fixed sample
    // prose. Every other tool stays a no-op (see the index footer).
    try {
      if (req && req.name === "read_recipe") {
        const uid = req.arguments && req.arguments.lookup && req.arguments.lookup.uid;
        let name = "Sample Recipe", servings = "", totalTime = "", photoResourceUri = "";
        try {
          const items = JSON.parse(this.#payload || "{}").items;
          const hit = Array.isArray(items) ? items.find((it) => it && it.uid === uid) : null;
          if (hit) { name = hit.name || name; servings = hit.servings || ""; totalTime = hit.totalTime || ""; photoResourceUri = hit.photoResourceUri || ""; }
        } catch {}
        const structuredContent = {
          uid: uid || "preview", name, servings, totalTime, photoResourceUri,
          ingredients: "2 egg yolks\\n1 stick unsalted butter, melted\\n1 tbsp lemon juice\\n4 eggs\\n2 English muffins, split",
          directions: "Whisk the yolks and lemon over a bain-marie.\\nStream in the warm butter until the sauce thickens.\\nPoach the eggs, toast the muffins, and spoon the sauce over the top.",
        };
        return Promise.resolve({ content: [{ type: "text", text: name }], structuredContent });
      }
    } catch {}
    return Promise.resolve({ content: [] });
  }
  openLink(args) { console.log("[widget-preview] openLink", args); return Promise.resolve({}); }
  downloadFile() { return Promise.resolve({}); }
}`;

/**
 * The `<script type="importmap">` injected into the vendor slot, pointing the bare ext-apps
 * specifier at {@link PREVIEW_SHIM_MODULE} as a base64 `data:` URL module. Base64 (not percent-
 * encoding) because its alphabet can't contain `</script`, so the data URL is safe inside the
 * importmap `<script>`. Computed once — the shim is static.
 */
const PREVIEW_IMPORTMAP = `<script type="importmap">${JSON.stringify({
  imports: {
    "@modelcontextprotocol/ext-apps": `data:text/javascript;base64,${Buffer.from(PREVIEW_SHIM_MODULE).toString("base64")}`,
  },
})}</script>`;
