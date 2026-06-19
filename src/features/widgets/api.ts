import type { EmptyApi } from "../../kernel/registry.js";

/**
 * Widgets' public contract — empty. Widgets is a FEATURE module: it serves the
 * prebuilt `ui://widget/{name}` HTML resources a host renders in a sandboxed
 * iframe (ADR-0019). Nothing else in the tree reads widget state — a
 * widget-bearing tool references its view by URI string through `ToolSpec.ui`,
 * not through this contract — so there is no surface to expose.
 */
export type WidgetsApi = EmptyApi;
