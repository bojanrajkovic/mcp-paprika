/**
 * The meal reads' structured output validated through the REAL SDK (ADR-0019, A3 #318).
 *
 * The unit tests (`*.test.ts`) drive the tools through `makeTestServer`, whose stub
 * discards the `registerTool` config and never runs the SDK's `validateToolOutput` —
 * so they prove the handler builds the right shape but are blind to whether the SDK
 * actually ACCEPTS that shape against the declared `outputSchema`. This file closes
 * that gap: it registers synthetic tools declaring the production schemas
 * (`mealListOutputSchema`, `searchMealHistoryOutputSchema`, `readRecipeHistoryOutputSchema`)
 * on a real `buildBrandedServer` and calls them over the in-memory transport, where
 * the SDK advertises the schema (`toJsonSchema`) and validates the result against it.
 * The payloads are built by the real `mealToStructuredRow` producer (and a hand-built
 * recipe summary), exercising branded UIDs, nullable branded FKs, a nullable label, a
 * nested array, and the `.extend()` / `.pick()` schema compositions — the shapes most
 * likely to trip the SDK. A non-error result here means the SDK accepted the schema.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ZodTypeAny } from "zod";

import type { DomainCtx, Infra } from "../../../kernel/registry.js";
import type { MealUid } from "../ids.js";

import { makeMeal } from "../../../../test/domains/meal/__fixtures__/meals.js";
import { connectInMemoryMcp } from "../../../../test/support/in-memory-mcp.js";
import { defineTool } from "../../../kernel/tool.js";
import { buildBrandedServer } from "../../../server/build.js";
import { toolResult } from "../../../shared/tools.js";
import { SILENT_LOG } from "../../../utils/log.js";
import { mealListOutputSchema, mealToStructuredRow } from "./helpers.js";
import { readRecipeHistoryOutputSchema } from "./recipe-history.js";
import { searchMealHistoryOutputSchema } from "./search-meal-history.js";

function makeCtx(server: McpServer): DomainCtx<unknown, never> {
  return { state: undefined, writes: {}, deps: {}, infra: { log: SILENT_LOG } as unknown as Infra, server };
}

// Rows that span the schema's nullable axes: a fully-linked meal (recipe + type +
// scale), a freeform one (recipeUid null), and a legacy one (typeUid + typeName null).
const rows = [
  mealToStructuredRow(
    makeMeal({ uid: "m-linked" as MealUid, recipeUid: "recipe-x", typeUid: "dinner-uid", scale: "2" }),
    "Dinner",
  ),
  mealToStructuredRow(makeMeal({ uid: "m-freeform" as MealUid, recipeUid: null, typeUid: "lunch-uid" }), "Lunch"),
  mealToStructuredRow(makeMeal({ uid: "m-legacy" as MealUid, typeUid: null }), null),
];

async function callStructured(outputSchema: ZodTypeAny, structured: Record<string, unknown>) {
  const server = buildBrandedServer();
  const tool = defineTool(
    {
      name: "meal_structured_probe",
      title: "Meal structured probe",
      description: "Returns a fixed structured payload to validate a production meal schema through the SDK.",
      annotations: { readOnlyHint: true },
      inputSchema: { unused: z.string().optional() },
      outputSchema,
    },
    (_ctx: DomainCtx<unknown, never>) => () => toolResult("ok", structured),
  );
  tool.register(makeCtx(server));
  const mcp = await connectInMemoryMcp(server);
  try {
    return await mcp.client.callTool({ name: "meal_structured_probe", arguments: {} });
  } finally {
    await mcp.close();
  }
}

describe("meal structured output validates through the SDK (R1, #318)", () => {
  it("mealListOutputSchema accepts the rows mealToStructuredRow produces", async () => {
    const result = await callStructured(mealListOutputSchema, { items: rows });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(3);
  });

  it("searchMealHistoryOutputSchema (.extend) accepts items plus the pagination cursor", async () => {
    const result = await callStructured(searchMealHistoryOutputSchema, { items: rows, total: 3, offset: 0 });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 3, offset: 0 });
  });

  it("readRecipeHistoryOutputSchema (.pick + nested) accepts a summary, including the zero-summary", async () => {
    const summary = await callStructured(readRecipeHistoryOutputSchema, {
      recipeUid: "recipe-x",
      recipeName: "Chocolate Cake",
      lastCooked: "2026-06-01",
      timesCooked: 2,
      recent: [
        { uid: "m-1", date: "2026-06-01", typeName: "Dinner" },
        { uid: "m-2", date: "2026-05-20", typeName: null },
      ],
    });
    expect(summary.isError).toBeFalsy();

    // The never-cooked zero-summary (lastCooked null, recent empty) also validates.
    const zero = await callStructured(readRecipeHistoryOutputSchema, {
      recipeUid: "recipe-x",
      recipeName: "Chocolate Cake",
      lastCooked: null,
      timesCooked: 0,
      recent: [],
    });
    expect(zero.isError).toBeFalsy();
  });
});
