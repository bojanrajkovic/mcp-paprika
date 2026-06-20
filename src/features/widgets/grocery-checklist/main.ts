import { mount } from "svelte";

import App from "./App.svelte";

/**
 * Browser entry for the grocery-checklist widget. The ext-apps runtime is inlined ahead of
 * this bundle by the widget build and exposed as `globalThis.ExtApps`, so it is read from the
 * global rather than imported. We construct the `App`, mount the Svelte component, and let the
 * component own the host handshake. Compiled by esbuild, not the project `tsc` (this dir is
 * excluded from both tsconfigs), so the types here are for readability only.
 */
interface McpAppLike {
  ontoolresult: ((result: unknown) => void) | undefined;
  onhostcontextchanged: ((ctx: { theme?: string } | undefined) => void) | undefined;
  connect(): Promise<void> | void;
  getHostContext(): { theme?: string } | undefined;
  callServerTool(call: { name: string; arguments: Record<string, unknown> }): Promise<unknown>;
}

const extApps = (globalThis as Record<string, unknown>)["ExtApps"] as {
  App: new (info: { name: string; version: string }, capabilities: object) => McpAppLike;
};

const app = new extApps.App({ name: "paprika-grocery-checklist", version: "1.0.0" }, {});

const target = document.getElementById("app");
if (target) {
  mount(App, { target, props: { app } });
}
