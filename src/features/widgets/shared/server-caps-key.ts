/** Key under which the widgets resource injects server capabilities into the served HTML. */
export const SERVER_CAPS_KEY = "__MCP_SERVER_CAPS__";

/**
 * Sentinel comment `renderShell` places immediately after `<body>`. Both
 * `widgets-resource.ts` (caps injection) and `widget-preview.ts` (ExtApps shim)
 * replace this literal with their `<script>` block — no HTML parsing required.
 */
export const WIDGET_INJECT_SLOT = "<!-- __widget-inject__ -->";
