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
    <div id="app"></div>
    <script type="module">globalThis.ExtApps ??= { App: class {} };</script>
  </body>
</html>
`;

describe("widget-preview route", () => {
  const tmp = useTempDir("mcp-paprika-widget-preview-");

  beforeEach(async () => {
    await tmp.setup();
    await writeFile(join(tmp.dir(), "demo.html"), FIXTURE_HTML, "utf8");
  });
  afterEach(async () => {
    await tmp.teardown();
  });

  it("serves a known widget with the host shim injected ahead of the module bundle", async () => {
    const router = buildWidgetPreviewRouter(SILENT_LOG, { dir: tmp.dir() });
    const res = await router.request("/widget-preview?widget=demo");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();

    // The fake host runtime is injected, and implements every pinned host method
    // (so the shim can't silently drop one the widgets rely on).
    expect(body).toContain("globalThis.ExtApps");
    for (const method of SHIMMED_HOST_METHODS) {
      expect(body).toContain(method);
    }

    // The shim also provides the top-level ExtApps style helpers. The two that host-style.ts
    // actually calls are pinned unconditionally so dropping one from SHIMMED_EXTAPPS_HELPERS
    // doesn't silently remove the assertion; the rest are asserted via the shared list.
    expect(body).toContain("applyHostStyleVariables");
    expect(body).toContain("applyHostFonts");
    for (const helper of SHIMMED_EXTAPPS_HELPERS) {
      expect(body).toContain(helper);
    }

    // The shim is a classic <script> ahead of the deferred module bundle, so it
    // claims globalThis.ExtApps first and the real (`??=`) runtime no-ops.
    expect(body.indexOf("<script>")).toBeLessThan(body.indexOf('<script type="module">'));

    // The App constructor sets window[SERVER_CAPS_KEY] from ?elicitation= so the
    // grocery checklist's elicitation-aware confirm can be exercised in the preview.
    expect(body).toContain(SERVER_CAPS_KEY);
    expect(body).toContain("supportsElicitation");
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
