/**
 * The two `@modelcontextprotocol/ext-apps` wire constants the widget surface
 * needs, mirrored as local literals rather than imported.
 *
 * ext-apps is a **build-time-only** devDependency: a widget's HTML is compiled to
 * a self-contained string by `scripts/build-widgets.ts` and read back at runtime,
 * so nothing on the runtime path may `import` the package — a `pnpm install
 * --prod` omits it. Importing these constants from `@modelcontextprotocol/
 * ext-apps/server` would re-pull the package into `dist/`, so we mirror their
 * VALUES here and pin them against the installed package with a drift test
 * (`mcp-app.test.ts`): the safety of a shared definition without the runtime
 * coupling.
 *
 * - `UI_RESOURCE_MIME_TYPE` is the MIME a `ui://` resource serves its HTML under —
 *   the signal a host uses to render the result in a sandboxed iframe rather than
 *   show the source. (ext-apps `RESOURCE_MIME_TYPE`.)
 * - `UI_RESOURCE_URI_META_KEY` is the legacy flat `_meta` key carrying a tool's UI
 *   resource URI. The kernel emits the preferred nested `_meta.ui.resourceUri` AND
 *   this legacy key — mirroring what ext-apps' `registerAppTool` produces — so a
 *   host that reads only the flat key still resolves the widget.
 *   (ext-apps `RESOURCE_URI_META_KEY`.)
 */
export const UI_RESOURCE_MIME_TYPE = "text/html;profile=mcp-app";
export const UI_RESOURCE_URI_META_KEY = "ui/resourceUri";
