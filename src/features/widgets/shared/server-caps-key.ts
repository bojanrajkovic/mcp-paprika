/** Key under which the widgets resource injects server capabilities into the served HTML. */
export const SERVER_CAPS_KEY = "__MCP_SERVER_CAPS__";

/**
 * Key under which the widgets resource injects the `resources/read` span's W3C `traceparent`
 * into the served HTML. The widget reads it on mount and reports its render-timing marks
 * back through `record_widget_timing`, which re-parents them under that span. Absent when the
 * read had no recording span (telemetry off), so the widget simply doesn't report.
 */
export const TRACEPARENT_KEY = "__MCP_TRACEPARENT__";

/**
 * Sentinel comment `renderShell` places immediately after `<body>`. Both
 * `widgets-resource.ts` (caps injection) and `widget-preview.ts` (ExtApps shim)
 * replace this literal with their `<script>` block — no HTML parsing required.
 */
export const WIDGET_INJECT_SLOT = "<!-- __widget-inject__ -->";

/**
 * Sentinel comment `renderShell` places immediately BEFORE the widget's
 * `<script type="module">` (which imports `@modelcontextprotocol/ext-apps`). The
 * serving layer replaces it with the `<script type="importmap">` that resolves
 * that bare specifier — to the self-hosted vendor URL under the HTTP transport, to
 * an inline `data:` URL under stdio, and to the fake-host shim module under the dev
 * preview (ADR-0025). An import map MUST precede the first module import, so this
 * slot sits ahead of the widget script.
 */
export const WIDGET_VENDOR_SLOT = "<!-- __widget-vendor__ -->";

/**
 * The bare specifier every widget bundle imports and the served import map resolves (ADR-0025). It is
 * a build↔serve contract that MUST be byte-identical on both sides — the build emits `import … from`
 * this exact string (esbuild `external`) and the import map keys on it — so it lives here, the one
 * module both `scripts/build-widgets.ts` and `artifacts.ts` already import, rather than duplicated.
 */
export const EXT_APPS_SPECIFIER = "@modelcontextprotocol/ext-apps";
