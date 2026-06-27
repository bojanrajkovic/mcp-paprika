import { execFileSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWidgets } from "../../../scripts/build-widgets.js";
import { useTempDir } from "../../../test/support/disk-caches.js";

/**
 * Drives the real widget build into a temp outDir against the real widget source
 * (`src/features/widgets/<name>/`), asserting each widget compiles to ONE `<name>.html` that
 * EXTERNALIZES the ext-apps runtime (a bare import the serving layer's import map resolves), plus the
 * single shared, content-hashed, pre-compressed `vendor-<hash>.js` every widget imports (ADR-0025).
 * The demo widget is the build's subject.
 */
describe("buildWidgets", () => {
  const tmp = useTempDir("mcp-paprika-widgets-");

  beforeEach(async () => {
    await tmp.setup();
  });
  afterEach(async () => {
    await tmp.teardown();
  });

  it("compiles each widget to <name>.html plus one shared vendor file", async () => {
    const built = await buildWidgets({ outDir: tmp.dir() });

    // The demo widget is discovered and built.
    expect(built).toContain("demo");

    const files = (await readdir(tmp.dir())).sort();
    // Exactly one HTML per widget (Svelte CSS is injected; esbuild's raw JS is wrapped into HTML).
    expect(files.filter((f) => f.endsWith(".html"))).toEqual(built.map((name) => `${name}.html`).sort());
    // Exactly one shared vendor module, with its brotli + gzip siblings (content-hashed name).
    const vendors = files.filter((f) => /^vendor-[0-9a-f]+\.js$/.test(f));
    expect(vendors).toHaveLength(1);
    const vendor = vendors[0];
    expect(files).toContain(`${vendor}.br`);
    expect(files).toContain(`${vendor}.gz`);

    const html = await readFile(join(tmp.dir(), "demo.html"), "utf8");

    // The ext-apps runtime is EXTERNALIZED: the widget keeps a bare import for the import map to
    // resolve, and the runtime is NOT inlined (no `globalThis.ExtApps` seam, no copied bundle).
    expect(html).toContain("@modelcontextprotocol/ext-apps");
    expect(html).not.toContain("globalThis.ExtApps");
    // The vendor slot the serving layer fills with the import map sits before the widget module.
    expect(html).toContain("<!-- __widget-vendor__ -->");
    // Without the inlined ~329 KB runtime, a widget's own HTML is small.
    expect(html.length).toBeLessThan(150_000);
    // The Svelte component compiled into the bundle — its static heading survives minification.
    expect(html).toContain("mcp-paprika widget demo");
  });

  // Every widget must compile to an inline ESM script that parses under module semantics and keeps the
  // externalized ext-apps import (never the inlined runtime). The grocery-checklist's larger compiled
  // output is the more likely place a regression sneaks in, so the guard runs per widget — add a name
  // here when a widget ships.
  it.each(["demo", "grocery-checklist", "pantry-checklist", "meal-week-planner", "recipe-browser"])(
    "%s compiles to an inline ESM module that externalizes the ext-apps runtime",
    async (name) => {
      await buildWidgets({ outDir: tmp.dir() });
      const html = await readFile(join(tmp.dir(), `${name}.html`), "utf8");

      // Externalized, not inlined: the bare import is present and the runtime is not copied in.
      expect(html).toContain("@modelcontextprotocol/ext-apps");
      expect(html).not.toContain("globalThis.ExtApps");

      // The widget runs in one inline `<script type="module">`; `node --check` with module semantics
      // is the exact check that the ESM bundle (with its bare external import) parses — `--check` does
      // syntax only, not resolution, so the unresolved bare specifier is fine.
      const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1] ?? "";
      expect(script.length).toBeGreaterThan(0);
      expect(script).toContain('from"@modelcontextprotocol/ext-apps"');
      const scriptPath = join(tmp.dir(), `${name}.inline.mjs`);
      await writeFile(scriptPath, script, "utf8");

      let parseError: string | null = null;
      try {
        execFileSync(process.execPath, ["--check", scriptPath], { stdio: "pipe" });
      } catch (err) {
        const stderr = (err as { stderr?: Buffer }).stderr?.toString() ?? "";
        parseError = `${err instanceof Error ? err.message : String(err)}\n${stderr}`;
      }
      expect(parseError).toBeNull();
    },
  );
});
