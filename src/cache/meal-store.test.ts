import { describe, it, expect, beforeEach } from "vitest";
import { DateTime } from "luxon";
import { MealStore } from "./meal-store.js";
import { makeMeal } from "./__fixtures__/meals.js";

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
      const meals = store.getByRecipeUid("recipe-1");
      expect(meals).toHaveLength(2);
      expect(meals.map((m) => m.name).sort()).toEqual(["Monday dinner", "Thursday dinner"]);
    });

    it("excludes isIngredient entries", () => {
      const meals = store.getByRecipeUid("recipe-1");
      expect(meals.every((m) => !m.isIngredient)).toBe(true);
    });

    it("returns empty for unknown recipe", () => {
      expect(store.getByRecipeUid("recipe-99")).toHaveLength(0);
    });
  });

  describe("lastCookedAt", () => {
    it("returns most recent date for a recipe", () => {
      store.load([
        makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00" }),
        makeMeal({ recipeUid: "recipe-1", date: "2026-03-20 00:00:00" }),
        makeMeal({ recipeUid: "recipe-1", date: "2026-02-10 00:00:00" }),
      ]);
      expect(store.lastCookedAt("recipe-1")).toBe("2026-03-20 00:00:00");
    });

    it("returns null for unknown recipe", () => {
      store.load([makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00" })]);
      expect(store.lastCookedAt("recipe-99")).toBeNull();
    });

    it("excludes isIngredient entries", () => {
      store.load([
        makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00" }),
        makeMeal({ recipeUid: "recipe-1", date: "2026-03-20 00:00:00", isIngredient: true }),
      ]);
      expect(store.lastCookedAt("recipe-1")).toBe("2026-01-15 00:00:00");
    });

    it("returns null when all entries are isIngredient", () => {
      store.load([makeMeal({ recipeUid: "recipe-1", date: "2026-01-15 00:00:00", isIngredient: true })]);
      expect(store.lastCookedAt("recipe-1")).toBeNull();
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
      const { meals, total } = store.getInDateRange({ recipeUid: "recipe-1" });
      expect(total).toBe(2);
      expect(meals.map((m) => m.name).sort()).toEqual(["Jan Dinner", "Mar Dinner"]);
    });

    it("filters by typeUid", () => {
      const { meals, total } = store.getInDateRange({ typeUid: "l" });
      expect(total).toBe(1);
      expect(meals[0]!.name).toBe("Feb Lunch");
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
});
