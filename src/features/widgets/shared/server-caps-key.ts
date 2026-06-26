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
