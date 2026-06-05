import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { collectToolSpecs, renderToolReference } from "../../scripts/tool-specs.js";
import { makeKernelInfra } from "../../test/support/kernel-harness.js";
import { registeredModules } from "./registry.js";
// Side-effect: every domain/feature module self-registers, so `registeredModules()`
// is populated and we can build the full registered surface.
import "./modules.generated.js";

const README = fileURLToPath(new URL("../../docs/tools/README.md", import.meta.url));

describe("tool reference (docs/tools/README.md)", () => {
  let cacheDir: string;
  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), "paprika-tool-ref-"));
  });
  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it("documents EXACTLY the tools the kernel registers (no drift)", async () => {
    // What the kernel registers: every module's built `tools`, which carry the same
    // `spec` the generator reads — built without a sync cycle (construction only).
    const infra = makeKernelInfra({ cacheDir });
    const registered = new Set<string>();
    for (const m of registeredModules()) {
      const built = await m.build(infra);
      for (const tool of built.tools) registered.add(tool.spec.name);
    }
    // What the generator documents: the globbed `defineTool` specs.
    const documented = new Set((await collectToolSpecs()).map((s) => s.name));

    // Equal sets ⇒ "documented ⇔ registered": no tool wired but undocumented, and
    // none documented but unwired. (Spec CONTENT can't drift — same object.)
    expect([...documented].sort()).toEqual([...registered].sort());
  });

  it("is up to date — run `pnpm generate:tool-reference` if this fails", async () => {
    const committed = await readFile(README, "utf-8");
    const rendered = renderToolReference(await collectToolSpecs());
    expect(committed).toBe(rendered);
  });
});
