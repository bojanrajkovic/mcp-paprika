import type { WidgetsApi } from "./api.js";
import type { VendorImportMap } from "./artifacts.js";

import { defineModule, register } from "../../kernel/registry.js";
import { loadVendorImportMap, loadWidgetArtifacts, widgetsDir } from "./artifacts.js";
import { widgetsResource } from "./resources/widgets-resource.js";
import { recordWidgetTimingTool } from "./tools/record-widget-timing.js";

declare module "../../kernel/registry.js" {
  interface DomainRegistry {
    widgets: WidgetsApi;
  }
}

/**
 * The widgets module's state: the built widget HTML, keyed by name, loaded ONCE
 * at construction (see {@link loadWidgetArtifacts}). A FEATURE module — it owns
 * no Paprika entity, so there is no store/cache pair and no `syncs[]`; it serves
 * the `ui://widget/{name}` resource (ADR-0019) and the app-only
 * `record_widget_timing` telemetry sink. A missing build degrades to an
 * empty map rather than failing boot, so the stdio transport and a fresh
 * `pnpm dev` are unaffected.
 */
export interface WidgetsState {
  /** name → widget HTML (with the inject + vendor slots), loaded once at construction. */
  readonly widgets: ReadonlyMap<string, string>;
  /**
   * How a served widget resolves its externalized ext-apps runtime — the import map injected into
   * the vendor slot, plus the CSP allowlist (HTTP only). Resolved once from the transport's public
   * URL (`config.oauth.publicUrl` ⇒ HTTP self-host, else stdio `data:` URL — ADR-0025). `null` when
   * no vendor file was built (degrades with the rest of the widget surface).
   */
  readonly vendor: VendorImportMap | null;
}

register(
  defineModule("widgets", [])
    .state<WidgetsState>(async (infra) => {
      const log = infra.log.child({ component: "widgets" });
      const dir = widgetsDir();
      // Discriminate on the TRANSPORT, not `oauth.publicUrl` presence: `MCP_PUBLIC_URL` maps to
      // `oauth.publicUrl` unconditionally (config.ts) and is only *required* under HTTP, never
      // *stripped* under stdio — so a stdio server with a stray `MCP_PUBLIC_URL` in its env would
      // otherwise externalize to an HTTP URL no local pipe can serve. Only HTTP has a route.
      const publicUrl = infra.config.transport === "http" ? infra.config.oauth?.publicUrl : undefined;
      return {
        widgets: await loadWidgetArtifacts(dir, log),
        vendor: await loadVendorImportMap(dir, publicUrl, log),
      };
    })
    .build(() => ({
      api: {},
      tools: [recordWidgetTimingTool],
      resources: [widgetsResource],
    })),
);
