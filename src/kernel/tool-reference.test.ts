import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectToolSpecs, renderToolReference } from "../../scripts/tool-specs.js";
import { useTempDir } from "../../test/support/disk-caches.js";
import { makeKernelInfra } from "../../test/support/kernel-harness.js";
import { registeredModules } from "./registry.js";
// Side-effect: every domain/feature module self-registers, so `registeredModules()`
// is populated and we can build the full registered surface.
import "./modules.generated.js";

const README = fileURLToPath(new URL("../../docs/tools/README.md", import.meta.url));

describe("tool reference (docs/tools/README.md)", () => {
  const tmp = useTempDir("paprika-tool-ref-");
  beforeEach(async () => {
    await tmp.setup();
  });
  afterEach(async () => {
    await tmp.teardown();
  });

  it("documents EXACTLY the tools the kernel registers (no drift)", async () => {
    // What the kernel registers: every module's built `tools`, which carry the same
    // `spec` the generator reads — built without a sync cycle (construction only).
    const infra = makeKernelInfra({ cacheDir: tmp.dir() });
    const registered = new Set<string>();
    for (const m of registeredModules()) {
      const built = await m.build(infra, {});
      for (const tool of built.tools) registered.add(tool.spec.name);
    }
    // What the generator DISCOVERS: the globbed `defineTool` specs. (Whether a discovered tool is
    // then RENDERED into the README is a separate, visibility-filtered pass — see the next test.)
    const documented = new Set((await collectToolSpecs()).map((s) => s.name));

    // Equal sets ⇒ "discovered ⇔ registered": no tool wired but undiscoverable, and none discovered
    // but unwired. (Spec CONTENT can't drift — same object.)
    expect([...documented].sort()).toEqual([...registered].sort());
  });

  it("excludes app-only tools from the rendered reference", async () => {
    // An app-only tool (`ui.visibility: ["app"]` — the record_widget_timing sink) is registered and
    // discovered, but it is not part of the model-facing surface, so `renderToolReference` drops it.
    const specs = await collectToolSpecs();
    const appOnly = specs.filter((s) => s.ui?.visibility !== undefined && !s.ui.visibility.includes("model"));
    expect(appOnly.length).toBeGreaterThan(0); // record_widget_timing
    const rendered = renderToolReference(specs);
    for (const s of appOnly) expect(rendered).not.toContain(`## \`${s.name}\``);
  });

  it("is up to date — run `pnpm generate:tool-reference` if this fails", async () => {
    const committed = await readFile(README, "utf-8");
    const rendered = renderToolReference(await collectToolSpecs());
    expect(committed).toBe(rendered);
  });
});
