/**
 * The recipe/category list tools' structured output validated through the REAL SDK
 * (ADR-0019, A3 #319).
 *
 * Uses {@link callStructuredProbe} to validate each production schema over the real
 * in-memory transport, fed by the real `recipeToRow` producer. Closes the gap the meal
 * e2e doesn't cover: `recipeRowSchema`'s `z.array(z.string())` (category names — plain
 * strings, not branded UIDs) and the category row's `CategoryUidSchema.nullable()`
 * parentUid (a branded schema wrapped in `.nullable()`). The menu/grocery list schemas
 * are branded-uid + int only — shape-classes the meal e2e already proves.
 */
import { describe, expect, it } from "vitest";

import type { RecipeUid } from "../ids.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { callStructuredProbe } from "../../../../test/support/structured-output-probe.js";
import { recipeToRow } from "../recipe-markdown.js";
import { listCategoriesOutputSchema } from "./list-categories.js";
import { listRecipesOutputSchema } from "./list.js";
import { searchRecipesOutputSchema } from "./search.js";

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

describe("recipe/category list structured output validates through the SDK (R1, #319)", () => {
  it("listRecipesOutputSchema accepts the rows recipeToRow produces (array<string> categories)", async () => {
    const result = await callStructuredProbe(listRecipesOutputSchema, { items: recipeRows, total: 2, offset: 0 });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(2);
  });

  it("searchRecipesOutputSchema accepts items plus the total match count", async () => {
    const result = await callStructuredProbe(searchRecipesOutputSchema, { items: recipeRows, total: 5 });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 5 });
  });

  it("listCategoriesOutputSchema accepts rows with a set and a null parentUid (nullable branded)", async () => {
    const result = await callStructuredProbe(listCategoriesOutputSchema, {
      items: [
        { uid: "c-parent", name: "Baking", recipeCount: 3, parentUid: null },
        { uid: "c-child", name: "Cakes", recipeCount: 1, parentUid: "c-parent" },
      ],
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(2);
  });
});
