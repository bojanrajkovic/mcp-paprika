import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { collectToolSpecs } from "../../scripts/tool-specs.js";

/**
 * ADR-0019 C1 cross-check (risk c): a tool's `ui.resourceUri` is a plain string,
 * so a typo compiles, registers, and only silently fails in a host — the widget
 * never renders, with no error anywhere on the server. This pins every declared
 * `ui` against a real widget SOURCE dir: `ui://widget/{name}` must have a
 * `src/features/widgets/{name}/main.ts` the build can compile.
 *
 * C1 ships the infra plus a throwaway demo but NO production tool that declares
 * `ui`, so the set is currently empty and this passes vacuously. It is the guard
 * that catches the FIRST widget-bearing tool (C2+) referencing a missing or
 * misspelled widget.
 */
const WIDGETS_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/features/widgets");
const UI_WIDGET_URI = /^ui:\/\/widget\/([a-z0-9-]+)$/;

describe("ADR-0019 C1: every tool ui.resourceUri points at a real widget", () => {
  it("each declared ui references a buildable widget source dir", async () => {
    const specs = await collectToolSpecs();
    const offenders: string[] = [];
    for (const spec of specs) {
      if (spec.ui === undefined) continue;
      const match = UI_WIDGET_URI.exec(spec.ui.resourceUri);
      const name = match?.[1];
      if (name === undefined) {
        offenders.push(`${spec.name}: malformed ui.resourceUri "${spec.ui.resourceUri}"`);
        continue;
      }
      if (!existsSync(join(WIDGETS_SRC, name, "main.ts"))) {
        offenders.push(`${spec.name}: no widget source for "${name}" (expected src/features/widgets/${name}/main.ts)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
