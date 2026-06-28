import { writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTempDir } from "../../../test/support/disk-caches.js";
import { SILENT_LOG } from "../../utils/log.js";
import { loadVendorBytes, loadVendorImportMap, loadWidgetArtifacts, widgetsDir } from "./artifacts.js";

describe("widgetsDir", () => {
  it("resolves to an absolute dist/widgets path", () => {
    const dir = widgetsDir();
    expect(isAbsolute(dir)).toBe(true);
    expect(dir.endsWith(join("dist", "widgets"))).toBe(true);
  });
});

describe("loadWidgetArtifacts", () => {
  const tmp = useTempDir("mcp-paprika-widget-artifacts-");

  beforeEach(async () => {
    await tmp.setup();
  });
  afterEach(async () => {
    await tmp.teardown();
  });

  it("loads each .html file into a name → html map", async () => {
    await writeFile(join(tmp.dir(), "demo.html"), "<html>demo</html>", "utf8");
    await writeFile(join(tmp.dir(), "grocery.html"), "<html>grocery</html>", "utf8");
    // A non-.html file is ignored.
    await writeFile(join(tmp.dir(), "notes.txt"), "ignore me", "utf8");

    const map = await loadWidgetArtifacts(tmp.dir(), SILENT_LOG);
    expect([...map.keys()].sort()).toEqual(["demo", "grocery"]);
    expect(map.get("demo")).toBe("<html>demo</html>");
  });

  it("degrades to an empty map when the directory is missing (no throw)", async () => {
    const map = await loadWidgetArtifacts(join(tmp.dir(), "does-not-exist"), SILENT_LOG);
    expect(map.size).toBe(0);
  });

  it("degrades to an empty map when the directory holds no widgets", async () => {
    const map = await loadWidgetArtifacts(tmp.dir(), SILENT_LOG);
    expect(map.size).toBe(0);
  });
});

describe("loadVendorImportMap", () => {
  const tmp = useTempDir("mcp-paprika-vendor-importmap-");
  const VENDOR = "vendor-deadbeefdeadbeef.js";
  const VENDOR_JS = "export const App = class {};";

  beforeEach(async () => {
    await tmp.setup();
    await writeFile(join(tmp.dir(), VENDOR), VENDOR_JS, "utf8");
  });
  afterEach(async () => {
    await tmp.teardown();
  });

  it("HTTP: keeps the full publicUrl path in the vendor URL and uses the bare origin for CSP", async () => {
    const vendor = await loadVendorImportMap(tmp.dir(), "https://host.example/paprika", SILENT_LOG);
    expect(vendor).not.toBeNull();
    // The URL carries the path prefix (resolves through a path-prefixing proxy, like the OAuth routes)…
    expect(vendor!.importMap).toContain(`https://host.example/paprika/widgets/${VENDOR}`);
    // …but the CSP source is a bare origin (a CSP source-expression is scheme+host+port, no path).
    expect(vendor!.csp).toEqual({ resourceDomains: ["https://host.example"] });
  });

  it("stdio: inlines the vendor as a base64 data: URL module and emits no CSP", async () => {
    const vendor = await loadVendorImportMap(tmp.dir(), undefined, SILENT_LOG);
    expect(vendor).not.toBeNull();
    expect(vendor!.csp).toBeUndefined();
    const b64 = vendor!.importMap.match(/data:text\/javascript;base64,([^"]+)/)?.[1];
    expect(b64).toBeDefined();
    expect(Buffer.from(b64!, "base64").toString("utf8")).toBe(VENDOR_JS);
  });

  it("degrades to null when no vendor file was built", async () => {
    const empty = useTempDir("mcp-paprika-vendor-empty-");
    await empty.setup();
    try {
      expect(await loadVendorImportMap(empty.dir(), "https://host.example", SILENT_LOG)).toBeNull();
      expect(await loadVendorBytes(empty.dir())).toBeNull();
    } finally {
      await empty.teardown();
    }
  });
});
