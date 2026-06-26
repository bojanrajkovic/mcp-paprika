import type { WidgetsApi } from "./api.js";

import { defineModule, register } from "../../kernel/registry.js";
import { loadWidgetArtifacts, widgetsDir } from "./artifacts.js";
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
  /** name → self-contained widget HTML, loaded once at construction. */
  readonly widgets: ReadonlyMap<string, string>;
}

register(
  defineModule("widgets", [])
    .state<WidgetsState>(async (infra) => ({
      widgets: await loadWidgetArtifacts(widgetsDir(), infra.log.child({ component: "widgets" })),
    }))
    .build(() => ({
      api: {},
      tools: [recordWidgetTimingTool],
      resources: [widgetsResource],
    })),
);
