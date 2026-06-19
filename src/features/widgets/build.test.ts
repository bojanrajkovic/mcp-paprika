import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWidgets } from "../../../scripts/build-widgets.js";
import { useTempDir } from "../../../test/support/disk-caches.js";

/**
 * Drives the real widget build into a temp outDir against the real widget source
 * (`src/features/widgets/<name>/`), asserting each widget compiles to ONE
 * self-contained HTML file — the property the iframe sandbox requires (no external
 * fetches) and the runtime relies on (it reads the finished string and never
 * imports the build toolchain). The demo widget is the build's subject.
 */
describe("buildWidgets", () => {
  const tmp = useTempDir("mcp-paprika-widgets-");

  beforeEach(async () => {
    await tmp.setup();
  });
  afterEach(async () => {
    await tmp.teardown();
  });

  it("compiles each widget to a single self-contained dist/widgets/<name>.html", async () => {
    const built = await buildWidgets({ outDir: tmp.dir() });

    // The demo widget is discovered and built.
    expect(built).toContain("demo");

    // Exactly one HTML file per widget, nothing else: Svelte CSS is injected and
    // esbuild's raw JS is wrapped into HTML (write: false), never emitted alone.
    const files = (await readdir(tmp.dir())).sort();
    expect(files).toEqual(built.map((name) => `${name}.html`).sort());

    const html = await readFile(join(tmp.dir(), "demo.html"), "utf8");

    // The ext-apps runtime is inlined and exposed as globalThis.ExtApps (the
    // trailing `export{…}` was rewritten), so the widget never imports the package.
    expect(html).toContain("globalThis.ExtApps");
    // The whole ext-apps bundle is really inlined (it is ~330 KB on its own).
    expect(html.length).toBeGreaterThan(100_000);
    // The Svelte component compiled into the bundle — its static heading survives.
    expect(html).toContain("mcp-paprika widget demo");
    // Self-contained: the CSP-sandboxed iframe can fetch no external script.
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
  });
});
