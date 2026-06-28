/**
 * The #320 list/discover schemas' structured output validated through the REAL SDK
 * (ADR-0019, A3 #320).
 *
 * Uses {@link callStructuredProbe} to validate each production schema over the real
 * in-memory transport. Focuses on the shapes #320 introduces that the meal/recipe-list
 * e2es don't already prove: `listMealTypesOutputSchema`'s `z.number().int().nullable()`
 * (the built-in index) and `discoverRecipesOutputSchema`'s `recipeRowSchema.extend({ score })`
 * (the shared recipe row plus a number). The pantry/aisle schemas are branded-uid +
 * nullable-string + int — shape-classes the earlier e2es already cover.
 */
import { describe, expect, it } from "vitest";

import type { RecipeUid } from "../../../domains/recipe/ids.js";

import { makeRecipe } from "../../../../test/domains/recipe/__fixtures__/recipes.js";
import { callStructuredProbe } from "../../../../test/support/structured-output-probe.js";
import { listMealTypesOutputSchema } from "../../../domains/meal-type/tools/list-meal-types.js";
import { listPantryItemsOutputSchema } from "../../../domains/pantry/pantry-helpers.js";
import { recipeToRow } from "../../../domains/recipe/recipe-markdown.js";
import { discoverRecipesOutputSchema } from "./discover-recipes.js";

describe("#320 catalog/discover structured output validates through the SDK (R1)", () => {
  it("listMealTypesOutputSchema accepts a set and a null originalType (nullable int)", async () => {
    const result = await callStructuredProbe(listMealTypesOutputSchema, {
      items: [
        { uid: "mt-1", name: "Dinner", originalType: 2 },
        { uid: "mt-2", name: "Brunch", originalType: null },
      ],
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(2);
  });

  it("listPantryItemsOutputSchema accepts null and set quantity/aisle (nullable strings)", async () => {
    const result = await callStructuredProbe(listPantryItemsOutputSchema, {
      items: [{ uid: "p-1", ingredient: "Eggs", quantity: null, aisle: null, inStock: false, expirationDate: null }],
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(1);
  });

  it("discoverRecipesOutputSchema accepts the shared recipe row plus a score (extend)", async () => {
    const row = { ...recipeToRow(makeRecipe({ uid: "r-1" as RecipeUid, name: "Cake" }), ["Dessert"]), score: 0.91 };
    const result = await callStructuredProbe(discoverRecipesOutputSchema, {
      context: { source: "discover", query: "cake" },
      items: [row],
    });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(1);
  });
});
