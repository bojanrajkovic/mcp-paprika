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
 * `GET /widget-preview?widget=<name>&theme=<light|dark>&userAgent=<host>&elicitation=<0|1>&touch=<0|1>#payload=<json>`:
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
 * true under plain viewport-resize emulation.
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
 * The payload rides the URL FRAGMENT (`#payload=`), never sent in the HTTP request
 * (RFC 3986 §3.5) — so a very-large-list stress test never trips Node's raw HTTP
 * header-size limit (a 431), and that ceiling is gone by construction rather than
 * dodged: the server literally cannot reflect what it never receives. The shim
 * reads `location.hash` CLIENT-SIDE and feeds it to the widget's `ontoolresult`,
 * where the widget JSON-parses it under its own try/catch — so there is no
 * server-side HTML reflection (no reflected-XSS surface) whichever channel
 * carries it. `?payload=` remains as a fallback for small hand-typed payloads,
 * still size-bounded below as defense-in-depth.
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
 * does at `resources/read` time), then parses the fragment/query payload into a per-page MINI-STORE
 * (`#data`) that `connect()` feeds to `ontoolresult` and every `callServerTool` handler reads AND
 * mutates in place, so a post-action re-read reflects the action. Its `getHostContext()`
 * reflects `?theme=` (light|dark) and `?userAgent=`; every other host method is a harmless no-op.
 * Authored as a string because it runs in the browser, not Node; the export surface is pinned against
 * ext-apps by {@link SHIMMED_HOST_METHODS} / {@link SHIMMED_EXTAPPS_HELPERS}.
 */
const PREVIEW_SHIM_MODULE = `
export function applyHostStyleVariables() {}
export function applyHostFonts() {}
export function applyDocumentTheme() {}
export function getDocumentTheme() {
  try { return new URLSearchParams(location.search).get("theme") === "dark" ? "dark" : "light"; }
  catch { return "light"; }
}
// ISO-date helpers for read_meal_plan's week re-dating. UTC-pinned so DST can't skew day math.
function addDays(iso, n) {
  const t = new Date(iso + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86400000);
}
export class App {
  ontoolresult;
  ontoolinput;
  onhostcontextchanged;
  #payload;
  #elicitation = false;
  // The mini-store: the parsed payload, mutated IN PLACE by the handlers below so post-action
  // re-reads return post-action state. Dumb by design — no dedup, no aisle resolution, no sorting;
  // the widgets' own logic is what's under preview.
  #data;
  #addSeq = 0;
  constructor() {
    // Separate try blocks: a missing \`window\`/\`location\` (the Node behavioral tests) must not
    // take payload parsing down with it.
    try {
      const q = new URLSearchParams(location.search);
      this.#elicitation = q.get("elicitation") === "1";
      // The payload rides the FRAGMENT — never sent in the HTTP request; ?payload=
      // remains a fallback for small hand-typed payloads.
      this.#payload = new URLSearchParams(location.hash.slice(1)).get("payload") ?? q.get("payload");
    } catch { this.#payload = null; }
    try { window["${SERVER_CAPS_KEY}"] = { supportsElicitation: this.#elicitation }; } catch {}
    try {
      const parsed = JSON.parse(this.#payload);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) this.#data = parsed;
    } catch {}
  }
  async connect() {
    if (this.#payload === null || this.#payload === undefined) return;
    this.ontoolresult && this.ontoolresult({ content: [{ type: "text", text: this.#payload }], structuredContent: this.#data });
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
  // The server confirm gate, faked: under ?elicitation=1 a native confirm() stands in for the
  // host's elicitation dialog (it too is a blocking modal outside the widget). Cancel = declined —
  // the caller must NOT mutate, and returns the decline shape (non-error, no structuredContent),
  // exactly what confirmOrCancel produces. Without the flag the gate never runs (a non-elicitation
  // client): proceed. \`typeof confirm\` guard keeps Node tests deterministic when unstubbed.
  #declined(message) {
    try { return this.#elicitation && typeof confirm === "function" && !confirm(message); }
    catch { return false; }
  }
  callServerTool(req) {
    const name = req && req.name;
    const args = (req && req.arguments) || {};
    const d = this.#data;
    const items = d && Array.isArray(d.items) ? d.items : null;
    const done = () => Promise.resolve({ content: [] });
    const ok = (structuredContent, text) =>
      Promise.resolve({ content: [{ type: "text", text: text || "" }], structuredContent });
    try {
      switch (name) {
        // ---- reads -------------------------------------------------------
        case "read_grocery_list":
        case "list_pantry_items":
          return d ? ok(d) : done();
        case "read_meal_plan": {
          if (!d || typeof d.weekStart !== "string" || !Array.isArray(d.meals)) return done();
          // Re-date the payload's meals into the requested window: every week looks alike, but
          // prev/next, the arrow clamps, and the mid-week realign all run their real paths.
          const start = typeof args.startDate === "string" ? args.startDate : d.weekStart;
          const shift = daysBetween(d.weekStart, start);
          const meals = d.meals.map((m) => ({ ...m, date: addDays(m.date, shift) }));
          return ok({ weekStart: start, meals, mealTypes: Array.isArray(d.mealTypes) ? d.mealTypes : [] });
        }
        case "read_recipe": {
          // Three payload shapes: browse rows key by recipe uid; menu rows by menu-item uid with
          // the recipe uid in \`recipeUid\` (+ a nested \`recipe\`); meal-week has \`meals\`, not \`items\`.
          const uid = args.lookup && args.lookup.uid;
          let recipeName = "Sample Recipe", servings = "", totalTime = "", photoResourceUri = "";
          const rows = items || (d && Array.isArray(d.meals) ? d.meals : null);
          const hit = rows ? rows.find((r) => r && (r.uid === uid || r.recipeUid === uid)) : null;
          if (hit) {
            recipeName = hit.name || recipeName;
            const src = hit.recipe && typeof hit.recipe === "object" ? hit.recipe : hit;
            servings = src.servings || ""; totalTime = src.totalTime || ""; photoResourceUri = src.photoResourceUri || "";
          }
          return ok({
            uid: uid || "preview", name: recipeName, servings, totalTime, photoResourceUri,
            ingredients: "2 egg yolks\\n1 stick unsalted butter, melted\\n1 tbsp lemon juice\\n4 eggs\\n2 English muffins, split",
            directions: "Whisk the yolks and lemon over a bain-marie.\\nStream in the warm butter until the sauce thickens.\\nPoach the eggs, toast the muffins, and spoon the sauce over the top.",
          }, recipeName);
        }
        // ---- grocery mutations --------------------------------------------
        case "mark_grocery_item_purchased": {
          const hit = items && items.find((i) => i && i.uid === args.uid);
          if (hit) hit.purchased = true;
          return done();
        }
        case "add_grocery_items": {
          // Echo the request back as rows. \`aisle: "" → null\`: the widget sends "" for a no-aisle
          // re-add, and echoing "" would mint a phantom "" aisle group in groupConsecutive.
          const rows = (Array.isArray(args.items) ? args.items : []).map((it) => ({
            uid: "preview-add-" + String(++this.#addSeq),
            ingredient: it && typeof it.ingredient === "string" ? it.ingredient : "Item",
            quantity: (it && it.quantity) ?? null,
            aisle: it && it.aisle ? it.aisle : null,
            purchased: false,
          }));
          if (items) items.push(...rows);
          return ok({ listUid: args.listUid || "preview-list", items: rows, skipped: [] });
        }
        case "delete_grocery_item": {
          if (items) d.items = items.filter((i) => !i || i.uid !== args.uid);
          return done();
        }
        case "clear_purchased_grocery_items": {
          if (this.#declined("Clear the purchased items?")) return done();
          if (items) d.items = items.filter((i) => i && !i.purchased);
          return done();
        }
        case "move_grocery_items_to_pantry": {
          if (this.#declined("Move the purchased items to the pantry?")) return done();
          const uids = Array.isArray(args.uids) ? args.uids : [];
          if (items) d.items = items.filter((i) => !i || !uids.includes(i.uid));
          return done();
        }
        // ---- pantry mutations ----------------------------------------------
        case "mark_pantry_item_out_of_stock":
        case "restock_pantry_item": {
          const hit = items && items.find((i) => i && i.uid === args.uid);
          if (hit) hit.inStock = name === "restock_pantry_item";
          return done();
        }
        case "clear_out_of_stock_pantry_items": {
          if (this.#declined("Remove the out-of-stock items?")) return done();
          // \`inStock !== false\` mirrors the pantry widget's documented fail-open default.
          if (items) d.items = items.filter((i) => i && i.inStock !== false);
          return done();
        }
        // record_widget_timing and anything unknown: harmless non-error no-op.
        default:
          return done();
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
