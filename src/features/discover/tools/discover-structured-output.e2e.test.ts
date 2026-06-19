/**
 * The #320 list/discover schemas' structured output validated through the REAL SDK
 * (ADR-0019, A3 #320).
 *
 * Like the meal (`meal-structured-output.e2e.test.ts`) and recipe-list
 * (`recipe/tools/list-structured-output.e2e.test.ts`) e2es, this registers synthetic
 * tools declaring the production schemas on a real `buildBrandedServer` and calls them
 * over the in-memory transport, where the SDK advertises the schema (`toJsonSchema`)
 * and validates the result — coverage the `makeTestServer` unit path can't reach. It
 * focuses on the shapes #320 introduces that the earlier e2es do not already prove:
 * `listMealTypesOutputSchema`'s `z.number().int().nullable()` (the built-in index) and
 * `discoverRecipesOutputSchema`'s `recipeRowSchema.extend({ score })` (the shared recipe
 * row plus a number). The pantry/aisle schemas are branded-uid + nullable-string + int —
 * shape-classes the meal/recipe-list e2es already cover.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ZodTypeAny } from "zod";

import type { RecipeUid } from "../../../domains/recipe/ids.js";
import type { DomainCtx, Infra } from "../../../kernel/registry.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { connectInMemoryMcp } from "../../../../test/support/in-memory-mcp.js";
import { listMealTypesOutputSchema } from "../../../domains/meal-type/tools/list-meal-types.js";
import { listPantryItemsOutputSchema } from "../../../domains/pantry/tools/list.js";
import { recipeToRow } from "../../../domains/recipe/recipe-markdown.js";
import { defineTool } from "../../../kernel/tool.js";
import { buildBrandedServer } from "../../../server/build.js";
import { toolResult } from "../../../shared/tools.js";
import { SILENT_LOG } from "../../../utils/log.js";
import { discoverRecipesOutputSchema } from "./discover-recipes.js";

function makeCtx(server: McpServer): DomainCtx<unknown, never> {
  return { state: undefined, writes: {}, deps: {}, infra: { log: SILENT_LOG } as unknown as Infra, server };
}

async function callStructured(outputSchema: ZodTypeAny, structured: Record<string, unknown>) {
  const server = buildBrandedServer();
  const tool = defineTool(
    {
      name: "catalog_structured_probe",
      title: "Catalog structured probe",
      description: "Returns a fixed structured payload to validate a production schema through the SDK.",
      annotations: { readOnlyHint: true },
      inputSchema: { unused: z.string().optional() },
      outputSchema,
    },
    (_ctx: DomainCtx<unknown, never>) => () => toolResult("ok", structured),
  );
  tool.register(makeCtx(server));
  const mcp = await connectInMemoryMcp(server);
  try {
    return await mcp.client.callTool({ name: "catalog_structured_probe", arguments: {} });
  } finally {
    await mcp.close();
  }
}

describe("#320 catalog/discover structured output validates through the SDK (R1)", () => {
  it("listMealTypesOutputSchema accepts a set and a null originalType (nullable int)", async () => {
    const result = await callStructured(listMealTypesOutputSchema, {
      items: [
        { uid: "mt-1", name: "Dinner", originalType: 2 },
        { uid: "mt-2", name: "Brunch", originalType: null },
      ],
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(2);
  });

  it("listPantryItemsOutputSchema accepts null and set quantity/aisle (nullable strings)", async () => {
    const result = await callStructured(listPantryItemsOutputSchema, {
      items: [{ uid: "p-1", ingredient: "Eggs", quantity: null, aisle: null, inStock: false, expirationDate: null }],
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(1);
  });

  it("discoverRecipesOutputSchema accepts the shared recipe row plus a score (extend)", async () => {
    const row = { ...recipeToRow(makeRecipe({ uid: "r-1" as RecipeUid, name: "Cake" }), ["Dessert"]), score: 0.91 };
    const result = await callStructured(discoverRecipesOutputSchema, { items: [row] });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(1);
  });
});
