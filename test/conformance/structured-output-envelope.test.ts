import { describe, expect, it } from "vitest";
import { z } from "zod";

import { collectToolSpecs } from "../../scripts/tool-specs.js";
import { RecipeUidSchema } from "../../src/domains/recipe/ids.js";
import { toolResult } from "../../src/shared/tools.js";

/**
 * ADR-0019 A1 conformance — the structured-output channel is *expressible* (the
 * two-argument `toolResult` envelope parses against a declared `outputSchema`)
 * yet still *inert* (no production tool declares a schema, so the SDK's output
 * validation never runs and the `tools/list` advertisement is unchanged).
 *
 * The positive check parses the envelope against the schema DIRECTLY:
 * `makeTestServer` discards the `registerTool` config and never runs the SDK's
 * `validateToolOutput`, so a harness round-trip would assert nothing. That a
 * declared schema reaches the real `tools/list` advertisement (the `toJsonSchema`
 * path) is anchored separately in `src/kernel/tool.e2e.test.ts`.
 *
 * The negative invariant is the tree-wide gate: every registered spec must carry
 * no `outputSchema`. A2 (#313) deliberately flips it for the first lookup tool —
 * at which point this assertion narrows to "all but that tool", it is not deleted.
 */

describe("ADR-0019 A1: structured-output envelope is expressible but inert", () => {
  it("a structured toolResult parses against the tool's own outputSchema", () => {
    // A representative list-read payload: rows wrapped under a record key (the
    // SDK's structuredContent is a record, never a bare top-level array), each
    // carrying a branded UID (a compile-time brand, plain string at runtime —
    // ADR-0007) plus the human-facing field.
    const outputSchema = z.object({
      items: z.array(z.object({ uid: RecipeUidSchema, name: z.string() })),
    });
    const payload = {
      items: [
        { uid: "r1", name: "Pasta" },
        { uid: "r2", name: "Soup" },
      ],
    };

    const result = toolResult("Pasta\nSoup", payload);

    // The text block is always present and unchanged by the structured channel.
    expect(result.content).toEqual([{ type: "text", text: "Pasta\nSoup" }]);
    // The structured payload satisfies the declared schema the SDK would validate.
    expect(outputSchema.safeParse(result.structuredContent).success).toBe(true);
  });

  it("no production tool declares an outputSchema (A1 is inert)", async () => {
    const withSchema = (await collectToolSpecs()).filter((s) => s.outputSchema !== undefined).map((s) => s.name);
    expect(withSchema).toEqual([]);
  });
});
