import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTempDir } from "../../test/support/disk-caches.js";
import { SERVER_CAPS_KEY } from "../features/widgets/shared/server-caps-key.js";
import { SILENT_LOG } from "../utils/log.js";
import { buildWidgetPreviewRouter, SHIMMED_EXTAPPS_HELPERS, SHIMMED_HOST_METHODS } from "./widget-preview.js";

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /></head>
  <body>
    <!-- __widget-inject__ -->
    <div id="app"></div>
    <!-- __widget-vendor__ -->
    <script type="module">import { App } from "@modelcontextprotocol/ext-apps"; new App();</script>
  </body>
</html>
`;

/** Decode the shim ES module from the served import map's `data:text/javascript;base64,…` target. */
function decodeShim(body: string): string {
  const b64 = body.match(/"@modelcontextprotocol\/ext-apps":"data:text\/javascript;base64,([^"]+)"/)?.[1];
  return b64 !== undefined ? Buffer.from(b64, "base64").toString("utf8") : "";
}

describe("widget-preview route", () => {
  const tmp = useTempDir("mcp-paprika-widget-preview-");

  beforeEach(async () => {
    await tmp.setup();
    await writeFile(join(tmp.dir(), "demo.html"), FIXTURE_HTML, "utf8");
  });
  afterEach(async () => {
    await tmp.teardown();
  });

  it("resolves the widget's ext-apps import to the host shim module via an import map", async () => {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir: tmp.dir() });
    const res = await router.request("/widget-preview?widget=demo");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();

    // An import map resolves the bare ext-apps specifier, and it must precede the module that imports
    // it (an import map is only honored ahead of the first module import).
    expect(body).toContain('<script type="importmap">');
    expect(body.indexOf('type="importmap"')).toBeLessThan(body.indexOf('type="module"'));

    // The shim module (carried as the import map's data: URL) implements every pinned host method and
    // top-level style helper, so it can't silently drop one the widgets rely on.
    const shim = decodeShim(body);
    expect(shim).not.toBe("");
    for (const method of SHIMMED_HOST_METHODS) {
      expect(shim).toContain(method);
    }
    // The two helpers host-style.ts actually calls are pinned unconditionally so dropping one from
    // SHIMMED_EXTAPPS_HELPERS doesn't silently remove the assertion; the rest ride the shared list.
    expect(shim).toContain("applyHostStyleVariables");
    expect(shim).toContain("applyHostFonts");
    for (const helper of SHIMMED_EXTAPPS_HELPERS) {
      expect(shim).toContain(helper);
    }

    // The App constructor sets window[SERVER_CAPS_KEY] from ?elicitation= so the grocery checklist's
    // elicitation-aware confirm can be exercised in the preview.
    expect(shim).toContain(SERVER_CAPS_KEY);
    expect(shim).toContain("supportsElicitation");
  });

  it("never reflects ?payload= into the served HTML (the shim reads it client-side)", async () => {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir: tmp.dir() });
    const res = await router.request(
      `/widget-preview?widget=demo&payload=${encodeURIComponent("<script>alert(1)</script>")}`,
    );

    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain("alert(1)");
  });

  it("rejects an oversized payload (413) before serving", async () => {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir: tmp.dir() });
    const huge = "x".repeat(64 * 1024 + 1);
    const res = await router.request(`/widget-preview?widget=demo&payload=${huge}`);
    expect(res.status).toBe(413);
  });

  it("answers 404 for an unknown widget and 400 when none is named", async () => {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir: tmp.dir() });

    expect((await router.request("/widget-preview?widget=missing")).status).toBe(404);
    expect((await router.request("/widget-preview")).status).toBe(400);
  });
});
