import { App } from "@modelcontextprotocol/ext-apps";
import { type Component, mount } from "svelte";

import { perfMark, perfMeasure } from "./shared/perf.js";

/** App identification handed to the ext-apps `App` constructor (its `Implementation`). */
interface WidgetInfo {
  readonly name: string;
  readonly version: string;
}

/**
 * Shared browser-entry bootstrap for every widget: construct the ext-apps `App` and mount the
 * widget's Svelte component with it as a prop. Each widget's `main.ts` is a one-liner over this.
 *
 * `App` is a VALUE import resolved at runtime by the import map the serving layer injects (ADR-0025) —
 * to the self-hosted `vendor-<hash>.js` over HTTP, an inline `data:` URL over stdio, or the preview
 * shim module. esbuild keeps it external, so it never bundles into the widget; this file is compiled
 * by esbuild (excluded from the project `tsc`, typed by `svelte-check`), so the value import stays off
 * the Node runtime path and ext-apps remains a build-time-only devDependency.
 *
 * `perfMark("boot")` is the FIRST line: its `timeOrigin`-relative offset is the parse/eval bucket
 * (HTML parse + this bundle; the ext-apps runtime now loads from a cached, separate module). `mounted`
 * closes the initial-render interval.
 */
export function mountWidget(info: WidgetInfo, component: Component<{ app: App }>): void {
  perfMark("boot");
  const app = new App(info, {});
  const target = document.getElementById("app");
  if (target) {
    mount(component, { target, props: { app } });
    perfMark("mounted");
    perfMeasure("boot-to-mounted", "boot", "mounted");
  }
}
