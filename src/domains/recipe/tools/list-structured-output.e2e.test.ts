/**
 * The recipe/category list tools' structured output validated through the REAL SDK
 * (ADR-0019, A3 #319).
 *
 * The unit tests drive these tools through `makeTestServer`, whose stub discards the
 * `registerTool` config and never runs the SDK's `validateToolOutput` — so they prove
 * the handler builds the right shape but not that the SDK ACCEPTS it. This closes that
 * gap for the #319 schemas the meal e2e (`meal/tools/meal-structured-output.e2e.test.ts`)
 * does not cover: it registers synthetic tools declaring the production schemas on a
 * real `buildBrandedServer` and calls them over the in-memory transport, where the SDK
 * advertises the schema (`toJsonSchema`) and validates the result. The payloads exercise
 * the shapes most likely to trip the SDK here: `recipeRowSchema`'s `z.array(z.string())`
 * (category names — an array of PLAIN strings, not branded UIDs) and the category row's
 * `CategoryUidSchema.nullable()` parentUid (a branded schema wrapped in `.nullable()`).
 * A non-error result means the SDK accepted the schema. The menu/grocery list schemas
 * are branded-uid + int only — shape-classes the meal e2e already proves.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { ZodTypeAny } from "zod";

import type { DomainCtx, Infra } from "../../../kernel/registry.js";
import type { RecipeUid } from "../ids.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { connectInMemoryMcp } from "../../../../test/support/in-memory-mcp.js";
import { defineTool } from "../../../kernel/tool.js";
import { buildBrandedServer } from "../../../server/build.js";
import { toolResult } from "../../../shared/tools.js";
import { SILENT_LOG } from "../../../utils/log.js";
import { recipeToRow } from "../recipe-markdown.js";
import { listCategoriesOutputSchema } from "./list-categories.js";
import { listRecipesOutputSchema } from "./list.js";
import { searchRecipesOutputSchema } from "./search.js";

function makeCtx(server: McpServer): DomainCtx<unknown, never> {
  return { state: undefined, writes: {}, deps: {}, infra: { log: SILENT_LOG } as unknown as Infra, server };
}

// Rows spanning recipeRowSchema's axes: named + empty categories, set + null times.
const recipeRows = [
  recipeToRow(makeRecipe({ uid: "r-1" as RecipeUid, name: "Cake", rating: 4, prepTime: "20 min", totalTime: "1 hr" }), [
    "Dessert",
    "Baking",
  ]),
  recipeToRow(
    makeRecipe({ uid: "r-2" as RecipeUid, name: "Toast", prepTime: null, cookTime: null, totalTime: null }),
    [],
  ),
];

async function callStructured(outputSchema: ZodTypeAny, structured: Record<string, unknown>) {
  const server = buildBrandedServer();
  const tool = defineTool(
    {
      name: "recipe_structured_probe",
      title: "Recipe structured probe",
      description: "Returns a fixed structured payload to validate a production list schema through the SDK.",
      annotations: { readOnlyHint: true },
      inputSchema: { unused: z.string().optional() },
      outputSchema,
    },
    (_ctx: DomainCtx<unknown, never>) => () => toolResult("ok", structured),
  );
  tool.register(makeCtx(server));
  const mcp = await connectInMemoryMcp(server);
  try {
    return await mcp.client.callTool({ name: "recipe_structured_probe", arguments: {} });
  } finally {
    await mcp.close();
  }
}

describe("recipe/category list structured output validates through the SDK (R1, #319)", () => {
  it("listRecipesOutputSchema accepts the rows recipeToRow produces (array<string> categories)", async () => {
    const result = await callStructured(listRecipesOutputSchema, { items: recipeRows, total: 2, offset: 0 });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(2);
  });

  it("searchRecipesOutputSchema accepts items plus the total match count", async () => {
    const result = await callStructured(searchRecipesOutputSchema, { items: recipeRows, total: 5 });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 5 });
  });

  it("listCategoriesOutputSchema accepts rows with a set and a null parentUid (nullable branded)", async () => {
    const result = await callStructured(listCategoriesOutputSchema, {
      items: [
        { uid: "c-parent", name: "Baking", recipeCount: 3, parentUid: null },
        { uid: "c-child", name: "Cakes", recipeCount: 1, parentUid: "c-parent" },
      ],
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(2);
  });
});
