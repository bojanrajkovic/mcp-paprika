import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTempDir } from "../../test/support/disk-caches.js";
import { SILENT_LOG } from "../utils/log.js";
import { buildWidgetVendorRouter } from "./widget-vendor.js";

const VENDOR = "vendor-deadbeefdeadbeef.js";

describe("widget-vendor route", () => {
  const tmp = useTempDir("mcp-paprika-widget-vendor-");

  beforeEach(async () => {
    await tmp.setup();
    await writeFile(join(tmp.dir(), VENDOR), "export const App = class {};", "utf8");
    await writeFile(join(tmp.dir(), `${VENDOR}.gz`), Buffer.from("gz-bytes"));
    await writeFile(join(tmp.dir(), `${VENDOR}.br`), Buffer.from("br-bytes"));
  });
  afterEach(async () => {
    await tmp.teardown();
  });

  it("serves the vendor with immutable cache + CORS, negotiating brotli", async () => {
    const router = await buildWidgetVendorRouter(SILENT_LOG, { dir: tmp.dir() });
    const res = await router.request(`/widgets/${VENDOR}`, { headers: { "accept-encoding": "gzip, deflate, br" } });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("vary")).toBe("accept-encoding");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("content-encoding")).toBe("br");
    expect(await res.text()).toBe("br-bytes");
  });

  it("falls back to gzip, then raw, by Accept-Encoding", async () => {
    const router = await buildWidgetVendorRouter(SILENT_LOG, { dir: tmp.dir() });

    const gz = await router.request(`/widgets/${VENDOR}`, { headers: { "accept-encoding": "gzip, deflate" } });
    expect(gz.headers.get("content-encoding")).toBe("gzip");
    expect(await gz.text()).toBe("gz-bytes");

    const raw = await router.request(`/widgets/${VENDOR}`, { headers: { "accept-encoding": "identity" } });
    expect(raw.headers.get("content-encoding")).toBeNull();
    expect(await raw.text()).toBe("export const App = class {};");
  });

  it("404s a filename that is not the content-hashed vendor", async () => {
    const router = await buildWidgetVendorRouter(SILENT_LOG, { dir: tmp.dir() });
    expect((await router.request("/widgets/vendor-0000000000000000.js")).status).toBe(404);
    expect((await router.request("/widgets/../secret.js")).status).toBe(404);
  });

  it("404s everything when no vendor file was built (degraded)", async () => {
    const empty = useTempDir("mcp-paprika-widget-vendor-empty-");
    await empty.setup();
    try {
      const router = await buildWidgetVendorRouter(SILENT_LOG, { dir: empty.dir() });
      expect((await router.request(`/widgets/${VENDOR}`)).status).toBe(404);
    } finally {
      await empty.teardown();
    }
  });
});
