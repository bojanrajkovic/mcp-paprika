import { mount } from "svelte";

/**
 * Shared browser-entry bootstrap for every widget: read the ext-apps `App` from the inlined
 * `globalThis.ExtApps` (never imported — the build-time-only devDependency rule + the iframe CSP),
 * construct it, and mount the widget's Svelte component with the app as a prop. Each widget's
 * `main.ts` is a one-liner over this. Compiled by esbuild, not the project `tsc` (excluded from both
 * tsconfigs, like every widget entry), so the types here are for readability only.
 */
export function mountWidget(info: { name: string; version: string }, App: unknown): void {
  const extApps = (globalThis as Record<string, unknown>)["ExtApps"] as {
    App: new (info: { name: string; version: string }, capabilities: object) => unknown;
  };
  const app = new extApps.App(info, {});
  const target = document.getElementById("app");
  if (target) {
    mount(App as Parameters<typeof mount>[0], { target, props: { app } });
  }
}
