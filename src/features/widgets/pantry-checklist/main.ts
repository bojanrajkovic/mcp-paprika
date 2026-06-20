import { mountWidget } from "../mount-widget.js";
import App from "./App.svelte";

/**
 * Browser entry for the pantry-checklist widget. The mount bootstrap (read the inlined ext-apps
 * runtime from `globalThis.ExtApps`, construct the App, mount the component) is shared in
 * `mount-widget.ts`. Compiled by esbuild, not the project `tsc`.
 */
mountWidget({ name: "paprika-pantry-checklist", version: "1.0.0" }, App);
