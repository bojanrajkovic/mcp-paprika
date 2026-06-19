/**
 * The meal reads' structured output validated through the REAL SDK (ADR-0019, A3 #318).
 *
 * Uses {@link callStructuredProbe} to register each production schema on a real server
 * and validate a representative payload over the in-memory transport — coverage the
 * `makeTestServer` unit path can't reach (it discards the config and never runs
 * `validateToolOutput`). The payloads (built by the real `mealToStructuredRow` producer)
 * exercise branded UIDs, nullable branded FKs, a nullable label, the nested `recent[]`,
 * and the `.extend()` / `.pick()` compositions.
 */
import { describe, expect, it } from "vitest";

import type { MealUid } from "../ids.js";

import { makeMeal } from "../../../../test/domains/meal/__fixtures__/meals.js";
import { callStructuredProbe } from "../../../../test/support/structured-output-probe.js";
import { mealListOutputSchema, mealToStructuredRow } from "./helpers.js";
import { readRecipeHistoryOutputSchema } from "./recipe-history.js";
import { searchMealHistoryOutputSchema } from "./search-meal-history.js";

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

describe("meal structured output validates through the SDK (R1, #318)", () => {
  it("mealListOutputSchema accepts the rows mealToStructuredRow produces", async () => {
    const result = await callStructuredProbe(mealListOutputSchema, { items: rows });
    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(3);
  });

  it("searchMealHistoryOutputSchema (.extend) accepts items plus the pagination cursor", async () => {
    const result = await callStructuredProbe(searchMealHistoryOutputSchema, { items: rows, total: 3, offset: 0 });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ total: 3, offset: 0 });
  });

  it("readRecipeHistoryOutputSchema (.pick + nested) accepts a summary, including the zero-summary", async () => {
    const summary = await callStructuredProbe(readRecipeHistoryOutputSchema, {
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
    const zero = await callStructuredProbe(readRecipeHistoryOutputSchema, {
      recipeUid: "recipe-x",
      recipeName: "Chocolate Cake",
      lastCooked: null,
      timesCooked: 0,
      recent: [],
    });
    expect(zero.isError).toBeFalsy();
  });
});
