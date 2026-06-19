import { mount } from "svelte";

import App from "./App.svelte";

/**
 * Browser entry for the demo widget — the proof that the C1 pipeline round-trips
 * end to end (build → `ui://` resource → host iframe → `app.connect()` → action
 * back out). It is a deliberately throwaway demo; the production widgets (the
 * grocery checklist, the cooking step view) ship with their own features against
 * the settled structured-payload shape.
 *
 * The ext-apps runtime is inlined ahead of this bundle by `scripts/build-widgets.ts`
 * and exposed as `globalThis.ExtApps` — it is never imported here, because bundling
 * ext-apps would defeat the build-time-only devDependency rule and the iframe CSP
 * cannot fetch it at runtime. We construct the `App`, hand it to the Svelte
 * component, and let the component own the host handshake.
 *
 * This file is compiled by esbuild, not the project's `tsc` (the per-widget source
 * dirs are excluded from both tsconfigs), so its types are for readability only.
 */
interface McpAppLike {
  ontoolresult: ((result: { content?: ReadonlyArray<{ text?: string }> }) => void) | undefined;
  connect(): Promise<void> | void;
  sendMessage(message: unknown): unknown;
}

const extApps = (globalThis as Record<string, unknown>)["ExtApps"] as {
  App: new (info: { name: string; version: string }, capabilities: object) => McpAppLike;
};

const app = new extApps.App({ name: "paprika-widget-demo", version: "1.0.0" }, {});

const target = document.getElementById("app");
if (target) {
  mount(App, { target, props: { app } });
}
