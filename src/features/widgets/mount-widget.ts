import type { App } from "@modelcontextprotocol/ext-apps";
import { type Component, mount } from "svelte";

import { perfMark, perfMeasure } from "./shared/perf.js";

/** App identification handed to the ext-apps `App` constructor (its `Implementation`). */
interface WidgetInfo {
  readonly name: string;
  readonly version: string;
}

/**
 * Shared browser-entry bootstrap for every widget: read the ext-apps `App` from the inlined
 * `globalThis.ExtApps` (never imported — the build-time-only devDependency rule + the iframe CSP),
 * construct it, and mount the widget's Svelte component with the app as a prop. Each widget's
 * `main.ts` is a one-liner over this.
 *
 * `App` is imported TYPE-only (erased like `widget-preview.ts`'s import): it types the constructor's
 * RETURN value, so the constructed `app` is a real `App` and `Component<{ app: App }>` enforces that
 * every widget component takes exactly the `app` prop this hands it — no ext-apps value reaches the
 * bundle. Compiled by esbuild, not the project `tsc`; `svelte-check` (`tsconfig.widgets.json`) types it.
 *
 * `perfMark("boot")` is the FIRST line: its `timeOrigin`-relative offset is the parse/eval bucket
 * (HTML parse + the inlined ext-apps runtime + this bundle), the largest slice of the placeholder
 * window. `mounted` closes the initial-render interval.
 */
export function mountWidget(info: WidgetInfo, component: Component<{ app: App }>): void {
  perfMark("boot");
  const extApps = (globalThis as unknown as { ExtApps: { App: new (info: WidgetInfo, capabilities: object) => App } })
    .ExtApps;
  const app = new extApps.App(info, {});
  const target = document.getElementById("app");
  if (target) {
    mount(component, { target, props: { app } });
    perfMark("mounted");
    perfMeasure("boot-to-mounted", "boot", "mounted");
  }
}
