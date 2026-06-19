import { describe, expect, it } from "vitest";
import { z } from "zod";

import { collectToolSpecs } from "../../scripts/tool-specs.js";
import { RecipeUidSchema } from "../../src/domains/recipe/ids.js";
import { toolResult } from "../../src/shared/tools.js";

/**
 * ADR-0019 structured-output conformance — the channel is *expressible* (the
 * two-argument `toolResult` envelope parses against a declared `outputSchema`) and
 * the rollout is *underway* (A3 #318 made the meal reads its first adopters).
 *
 * The positive check parses the envelope against the schema DIRECTLY:
 * `makeTestServer` discards the `registerTool` config and never runs the SDK's
 * `validateToolOutput`, so a harness round-trip would assert nothing. That a
 * declared schema reaches the real `tools/list` advertisement (the `toJsonSchema`
 * path), and the SDK's success/`isError` validation contract, are anchored
 * separately in `src/kernel/tool.e2e.test.ts`.
 *
 * The adoption invariant is the tree-wide gate: it pins the EXACT set of
 * schema-bearing tools. It started empty (A1 was inert); A3 #318 added the three
 * meal reads. Each later A3/A2/B1 batch ADDS its tool names here — an explicit
 * allowlist, so a tool that gains a schema unexpectedly (or one that should have
 * but didn't) trips the gate rather than sliding by.
 */

describe("ADR-0019: structured-output envelope and rollout", () => {
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

  it("exactly the A3 meal reads declare an outputSchema (the rollout's current frontier)", async () => {
    const withSchema = (await collectToolSpecs())
      .filter((s) => s.outputSchema !== undefined)
      .map((s) => s.name)
      .sort();
    // A3 #318 — the meal reads, the first adopters. A3 #319 — the recipe/grocery/menu
    // list tools. Add each later batch's tool names as they land.
    expect(withSchema).toEqual([
      "list_categories",
      "list_grocery_lists",
      "list_menus",
      "list_recipes",
      "read_meal_plan",
      "read_recipe_history",
      "search_meal_history",
      "search_recipes",
    ]);
  });
});
