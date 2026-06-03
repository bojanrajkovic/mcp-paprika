import { DateTime } from "luxon";
import { beforeEach, describe, expect, it } from "vitest";

import type { MealTypeUid, MealUid, RecipeUid } from "../ids.js";

import { makeMeal } from "../cache/__fixtures__/meals.js";
import { MealStore } from "./store.js";

describe("MealStore", () => {
  let store: MealStore;

  beforeEach(() => {
    store = new MealStore();
  });

  it("starts with hasSynced false", () => {
    expect(store.hasSynced).toBe(false);
  });

  it("load sets hasSynced", () => {
    store.load([]);
    expect(store.hasSynced).toBe(true);
  });

  describe("getByRecipeUid", () => {
    beforeEach(() => {
      store.load([
        makeMeal({ recipeUid: "recipe-1", name: "Monday dinner" }),
        makeMeal({ recipeUid: "recipe-1", name: "Thursday dinner" }),
        makeMeal({ recipeUid: "recipe-2", name: "Other recipe" }),
        makeMeal({ recipeUid: null, name: "Freeform" }),
        makeMeal({ recipeUid: "recipe-1", name: "Prep work", isIngredient: true }),
      ]);
    });

    it("returns meals for a specific recipe", () => {
      const meals = store.getByRecipeUid("recipe-1" as RecipeUid);
      expect(meals).toHaveLength(2);
      expect(meals.map((m) => m.name).sort()).toEqual(["Monday dinner", "Thursday dinner"]);
    });

    it("excludes isIngredient entries", () => {
      const meals = store.getByRecipeUid("recipe-1" as RecipeUid);
      expect(meals.every((m) => !m.isIngredient)).toBe(true);
    });

    it("returns empty for unknown recipe", () => {
      expect(store.getByRecipeUid("recipe-99" as RecipeUid)).toHaveLength(0);
    });

    it("excludes deleted meals", () => {
      store.load([
        makeMeal({ recipeUid: "recipe-1", name: "Live", date: "2026-01-10 00:00:00" }),
        makeMeal({ recipeUid: "recipe-1", name: "Tombstone", date: "2026-01-15 00:00:00", deleted: true }),
      ]);
      const meals = store.getByRecipeUid("recipe-1" as RecipeUid);
      expect(meals).toHaveLength(1);
      expect(meals[0]!.name).toBe("Live");
    });
  });

  describe("lastCookedAt", () => {
    it("returns most recent date for a recipe", () => {
      store.load([
        makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00" }),
        makeMeal({ recipeUid: "recipe-1", date: "2026-03-20 00:00:00" }),
        makeMeal({ recipeUid: "recipe-1", date: "2026-02-10 00:00:00" }),
      ]);
      expect(store.lastCookedAt("recipe-1" as RecipeUid)).toBe("2026-03-20 00:00:00");
    });

    it("returns null for unknown recipe", () => {
      store.load([makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00" })]);
      expect(store.lastCookedAt("recipe-99" as RecipeUid)).toBeNull();
    });

    it("excludes isIngredient entries", () => {
      store.load([
        makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00" }),
        makeMeal({ recipeUid: "recipe-1", date: "2026-03-20 00:00:00", isIngredient: true }),
      ]);
      expect(store.lastCookedAt("recipe-1" as RecipeUid)).toBe("2026-01-15 00:00:00");
    });

    it("returns null when all entries are isIngredient", () => {
      store.load([makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00", isIngredient: true })]);
      expect(store.lastCookedAt("recipe-1" as RecipeUid)).toBeNull();
    });

    it("excludes deleted meals", () => {
      store.load([
        makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00" }),
        // A later deleted entry must NOT shadow the live one as "most recent"
        makeMeal({ recipeUid: "recipe-1", date: "2026-03-20 00:00:00", deleted: true }),
      ]);
      expect(store.lastCookedAt("recipe-1" as RecipeUid)).toBe("2026-01-15 00:00:00");
    });

    it("excludes future planner entries", () => {
      const now = DateTime.fromISO("2026-03-01T00:00:00", { zone: "utc" });
      store.load([
        makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00" }),
        // A scheduled future planner entry should NOT count as last cooked
        makeMeal({ recipeUid: "recipe-1", date: "2026-04-20 00:00:00" }),
      ]);
      expect(store.lastCookedAt("recipe-1" as RecipeUid, now)).toBe("2026-01-15 00:00:00");
    });

    it("returns null when only future entries exist", () => {
      const now = DateTime.fromISO("2026-03-01T00:00:00", { zone: "utc" });
      store.load([makeMeal({ recipeUid: "recipe-1", date: "2026-04-20 00:00:00" })]);
      expect(store.lastCookedAt("recipe-1" as RecipeUid, now)).toBeNull();
    });
  });

  describe("getInDateRange", () => {
    beforeEach(() => {
      store.load([
        makeMeal({ recipeUid: "recipe-1", name: "Jan Dinner", date: "2026-01-15 00:00:00", type: 2, typeUid: "d" }),
        makeMeal({ recipeUid: "recipe-2", name: "Feb Lunch", date: "2026-02-10 00:00:00", type: 1, typeUid: "l" }),
        makeMeal({ recipeUid: null, name: "Feb Dinner", date: "2026-02-10 00:00:00", type: 2, typeUid: "d" }),
        makeMeal({ recipeUid: "recipe-1", name: "Mar Dinner", date: "2026-03-20 00:00:00", type: 2, typeUid: "d" }),
        makeMeal({ name: "Prep", date: "2026-02-10 00:00:00", isIngredient: true }),
      ]);
    });

    it("returns all non-ingredient meals when no filters", () => {
      const { meals, total } = store.getInDateRange();
      expect(total).toBe(4);
      expect(meals).toHaveLength(4);
    });

    it("excludes isIngredient entries", () => {
      const { meals } = store.getInDateRange();
      expect(meals.every((m) => !m.isIngredient)).toBe(true);
    });

    it("filters by since/until dates", () => {
      const { meals, total } = store.getInDateRange({
        since: DateTime.fromISO("2026-02-01", { zone: "utc" }),
        until: DateTime.fromISO("2026-02-28", { zone: "utc" }),
      });
      expect(total).toBe(2);
      expect(meals.map((m) => m.name).sort()).toEqual(["Feb Dinner", "Feb Lunch"]);
    });

    it("filters by recipeUid", () => {
      const { meals, total } = store.getInDateRange({ recipeUid: "recipe-1" as RecipeUid });
      expect(total).toBe(2);
      expect(meals.map((m) => m.name).sort()).toEqual(["Jan Dinner", "Mar Dinner"]);
    });

    it("filters by typeUid", () => {
      const { meals, total } = store.getInDateRange({ typeUid: "l" as MealTypeUid });
      expect(total).toBe(1);
      expect(meals[0]!.name).toBe("Feb Lunch");
    });

    it("includes legacy meals (typeUid: null) matching legacyTypeInteger", () => {
      // Add a legacy meal: no typeUid, just the integer type
      store.load([
        makeMeal({ name: "Legacy Dinner", date: "2026-01-10 00:00:00", type: 2, typeUid: null }),
        makeMeal({ name: "Modern Dinner", date: "2026-01-15 00:00:00", type: 2, typeUid: "dinner-uid" }),
        makeMeal({ name: "Legacy Lunch", date: "2026-01-10 00:00:00", type: 1, typeUid: null }),
      ]);
      const { meals, total } = store.getInDateRange({
        typeUid: "dinner-uid" as MealTypeUid,
        legacyTypeInteger: 2,
      });
      expect(total).toBe(2);
      expect(meals.map((m) => m.name).sort()).toEqual(["Legacy Dinner", "Modern Dinner"]);
    });

    it("does not match legacy meals when legacyTypeInteger is omitted (custom-type filter)", () => {
      store.load([
        makeMeal({ name: "Legacy Dinner", date: "2026-01-10 00:00:00", type: 2, typeUid: null }),
        makeMeal({ name: "Custom Type", date: "2026-01-15 00:00:00", type: 4, typeUid: "custom-uid" }),
      ]);
      // typeUid set, but no legacyTypeInteger → legacy meals must NOT match
      const { meals, total } = store.getInDateRange({ typeUid: "custom-uid" as MealTypeUid });
      expect(total).toBe(1);
      expect(meals[0]!.name).toBe("Custom Type");
    });

    it("excludes deleted meals from all queries", () => {
      store.load([
        makeMeal({ recipeUid: "recipe-1", name: "Live Meal", date: "2026-01-10 00:00:00" }),
        makeMeal({ recipeUid: "recipe-1", name: "Deleted Meal", date: "2026-01-15 00:00:00", deleted: true }),
      ]);
      const { meals, total } = store.getInDateRange();
      expect(total).toBe(1);
      expect(meals[0]!.name).toBe("Live Meal");
    });

    it("sorts date-descending, then type-ascending within same date", () => {
      const { meals } = store.getInDateRange();
      expect(meals[0]!.name).toBe("Mar Dinner");
      const feb = meals.filter((m) => m.date.startsWith("2026-02"));
      expect(feb[0]!.type).toBeLessThanOrEqual(feb[1]!.type);
    });

    it("respects offset and limit", () => {
      const { meals, total } = store.getInDateRange({ offset: 1, limit: 2 });
      expect(total).toBe(4);
      expect(meals).toHaveLength(2);
    });

    it("returns empty for date range with no meals", () => {
      const { meals, total } = store.getInDateRange({
        since: DateTime.fromISO("2030-01-01", { zone: "utc" }),
        until: DateTime.fromISO("2030-12-31", { zone: "utc" }),
      });
      expect(total).toBe(0);
      expect(meals).toHaveLength(0);
    });
  });

  describe("getMaxOrderFlagOn", () => {
    const DATE = "2026-06-01 00:00:00";
    const OTHER_DATE = "2026-06-02 00:00:00";
    const TYPE_UID = "type-uid-x";
    const OTHER_TYPE_UID = "type-uid-y";

    // order_flag sequences per calendar DATE across all meal types — the wire
    // capture shows two same-date meals of different types post as 0 and 1,
    // while two same-type meals on different dates both post as 0
    // (docs/wire-captures/meals.har.json).
    it("returns the highest orderFlag among meals on the date", () => {
      store.load([
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 0 }),
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 1 }),
      ]);
      expect(store.getMaxOrderFlagOn(DATE)).toBe(1);
    });

    // The decisive per-date assertion: meals of DIFFERENT types on the same date
    // share ONE sequence, so the max spans types (it does NOT reset per type).
    it("spans all meal types on the date — max is across types, not per (date, type)", () => {
      store.load([
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 0 }),
        makeMeal({ date: DATE, typeUid: OTHER_TYPE_UID, orderFlag: 1 }),
      ]);
      // A per-(date, type) bucket would return 0 for each type; per-date returns 1.
      expect(store.getMaxOrderFlagOn(DATE)).toBe(1);
    });

    // legacy null-typeUid meals participate in the same per-date sequence.
    it("includes legacy null-typeUid meals in the per-date max", () => {
      store.load([
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 3 }),
        makeMeal({ date: DATE, typeUid: null, orderFlag: 5 }),
      ]);
      expect(store.getMaxOrderFlagOn(DATE)).toBe(5);
    });

    // returns null (not 0, not -1) when no meal exists on the date
    it("returns null when no meals exist on the date", () => {
      store.load([]);
      expect(store.getMaxOrderFlagOn(DATE)).toBeNull();
    });

    it("returns null for a different date with no meals on the target date", () => {
      store.load([makeMeal({ date: OTHER_DATE, typeUid: TYPE_UID, orderFlag: 5 })]);
      expect(store.getMaxOrderFlagOn(DATE)).toBeNull();
    });

    it("excludes server-side deleted meals (deleted: true in load)", () => {
      store.load([
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 0 }),
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 1 }),
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 5, deleted: true }),
      ]);
      expect(store.getMaxOrderFlagOn(DATE)).toBe(1);
    });

    it("excludes in-session deleted meals (tombstoned via store.delete)", () => {
      const target = makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 5 });
      store.load([
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 0 }),
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 1 }),
        target,
      ]);
      store.delete(target.uid);
      expect(store.getMaxOrderFlagOn(DATE)).toBe(1);
    });

    it("excludes isIngredient meals from the max calculation", () => {
      store.load([
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 0 }),
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 1 }),
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 5, isIngredient: true }),
      ]);
      expect(store.getMaxOrderFlagOn(DATE)).toBe(1);
    });

    it("excludes pending-delete meals so soft-delete + same-date add doesn't inflate flags", () => {
      // Regression for the code-review finding: between markPendingDelete and
      // store.delete (the cache-flush window), commitMeal hasn't yet mutated
      // the in-memory entry. Without filtering on isPendingDelete, the
      // soon-to-be-gone meal counts toward the date max and the next add
      // assigns a higher flag than necessary, drifting flags upward across
      // delete+add cycles.
      const movingUid = "uid-pending-delete" as MealUid;
      store.load([
        makeMeal({ uid: movingUid, date: DATE, typeUid: TYPE_UID, orderFlag: 5 }),
        makeMeal({ date: DATE, typeUid: TYPE_UID, orderFlag: 2 }),
      ]);
      // Before pending-delete, the date max is 5 (the moving meal).
      expect(store.getMaxOrderFlagOn(DATE)).toBe(5);

      // Simulate commitMeal's delete-branch state: the UID is marked pending-
      // delete but the entry is still in _items (delete() hasn't run yet).
      store.markPendingDelete(movingUid);

      // After pending-delete, the date max ignores the moving meal and returns
      // the next-highest flag — so the subsequent add would get orderFlag 3, not 6.
      expect(store.getMaxOrderFlagOn(DATE)).toBe(2);
    });
  });
});
