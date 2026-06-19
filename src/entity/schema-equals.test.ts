import { describe, expect, it } from "vitest";
import { z } from "zod";

import { mealsEqual, MealStoredSchema } from "../domains/meal/types.js";
import { categoriesEqual, CategoryStoredSchema } from "../domains/recipe/category/types.js";
import { makeSchemaEquals } from "./schema-equals.js";

describe("makeSchemaEquals", () => {
  // A stand-in entity that mirrors the real shape: primitive fields, a nullable
  // field, and the soft-delete `deleted` flag with the codebase-wide
  // `optional().default(false)`.
  const ItemSchema = z.object({
    uid: z.string(),
    name: z.string(),
    count: z.number().int(),
    note: z.string().nullable(),
    deleted: z.boolean().optional().default(false),
  });
  const equals = makeSchemaEquals(ItemSchema);
  const base = { uid: "u1", name: "a", count: 1, note: null, deleted: false };

  it("is true when every compared field matches", () => {
    expect(equals({ ...base }, { ...base })).toBe(true);
  });

  it("is false when any compared field differs", () => {
    expect(equals(base, { ...base, uid: "u2" })).toBe(false);
    expect(equals(base, { ...base, name: "b" })).toBe(false);
    expect(equals(base, { ...base, count: 2 })).toBe(false);
  });

  it("treats null as equal to null and unequal to a value (nullable field)", () => {
    expect(equals({ ...base, note: null }, { ...base, note: null })).toBe(true);
    expect(equals({ ...base, note: "x" }, { ...base, note: "x" })).toBe(true);
    expect(equals({ ...base, note: null }, { ...base, note: "x" })).toBe(false);
  });

  // The crux of #240's "audit before collapsing": `deleted` is excluded, so two
  // rows differing only in the soft-delete flag still compare equal (it never
  // changes on a read, so it must not register as a content change).
  it("excludes `deleted` from comparison", () => {
    expect(equals({ ...base, deleted: false }, { ...base, deleted: true })).toBe(true);
  });

  // A schema without `deleted` (e.g. Category) compares all of its fields; the
  // exclusion is a no-op rather than a special case.
  it("compares every field when the schema has no `deleted`", () => {
    const eq = makeSchemaEquals(z.object({ uid: z.string(), name: z.string() }));
    expect(eq({ uid: "u", name: "a" }, { uid: "u", name: "a" })).toBe(true);
    expect(eq({ uid: "u", name: "a" }, { uid: "u", name: "b" })).toBe(false);
  });

  // Deep (not reference) comparison: this is why a future nested field can't
  // silently churn or miss — equal-by-value structures compare equal.
  it("compares nested fields by value", () => {
    const eq = makeSchemaEquals(z.object({ uid: z.string(), tags: z.array(z.string()) }));
    expect(eq({ uid: "u", tags: ["a", "b"] }, { uid: "u", tags: ["a", "b"] })).toBe(true);
    expect(eq({ uid: "u", tags: ["a", "b"] }, { uid: "u", tags: ["a", "c"] })).toBe(false);
  });
});

// Pins the integration on real entity schemas — branded UIDs (plain strings at
// runtime), nullable foreign-key refs, the full field set — so the
// per-entity comparators stay equivalent to the hand-rolled ones they replaced.
describe("makeSchemaEquals over real entity schemas", () => {
  it("excludes `deleted` but catches a real field change (Meal: branded UIDs, nullable refs)", () => {
    const meal = MealStoredSchema.parse({
      uid: "meal-1",
      recipeUid: null,
      name: "Pancakes",
      date: "2026-01-01",
      type: 0,
      typeUid: null,
      orderFlag: 0,
      isIngredient: false,
      scale: null,
    });
    expect(mealsEqual(meal, { ...meal })).toBe(true);
    expect(mealsEqual(meal, { ...meal, deleted: true })).toBe(true);
    expect(mealsEqual(meal, { ...meal, name: "Waffles" })).toBe(false);
    expect(mealsEqual(meal, { ...meal, recipeUid: null })).toBe(true);
  });

  it("compares every field for a schema with no `deleted` (Category)", () => {
    const category = CategoryStoredSchema.parse({ uid: "cat-1", name: "Breakfast", orderFlag: 0, parentUid: null });
    expect(categoriesEqual(category, { ...category })).toBe(true);
    expect(categoriesEqual(category, { ...category, name: "Brunch" })).toBe(false);
    expect(categoriesEqual(category, { ...category, orderFlag: 1 })).toBe(false);
  });
});
