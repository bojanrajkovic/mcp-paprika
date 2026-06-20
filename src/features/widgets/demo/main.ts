import { mountWidget } from "../mount-widget.js";
import App from "./App.svelte";

/**
 * Browser entry for the demo widget — the proof that the C1 pipeline round-trips end to end (build →
 * `ui://` resource → host iframe → `app.connect()` → action back out). A deliberately throwaway demo;
 * the production widgets ship with their own features. The mount bootstrap (read the inlined ext-apps
 * runtime, construct the App, mount the component) is shared in `mount-widget.ts`.
 */
mountWidget({ name: "paprika-widget-demo", version: "1.0.0" }, App);
