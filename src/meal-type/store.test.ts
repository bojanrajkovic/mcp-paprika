import { beforeEach, describe, expect, it } from "vitest";

import { makeMealType } from "../cache/__fixtures__/meals.js";
import { MealTypeStore } from "./store.js";

describe("MealTypeStore", () => {
  let store: MealTypeStore;

  beforeEach(() => {
    store = new MealTypeStore();
  });

  it("starts with hasSynced false", () => {
    expect(store.hasSynced).toBe(false);
  });

  it("load populates items and sets hasSynced", () => {
    const types = [makeMealType({ name: "Breakfast" }), makeMealType({ name: "Dinner" })];
    store.load(types);
    expect(store.hasSynced).toBe(true);
    expect(store.getAll()).toHaveLength(2);
  });

  it("load with empty array sets hasSynced", () => {
    store.load([]);
    expect(store.hasSynced).toBe(true);
    expect(store.getAll()).toHaveLength(0);
  });

  describe("resolveByName", () => {
    beforeEach(() => {
      store.load([
        makeMealType({ name: "Breakfast" }),
        makeMealType({ name: "Lunch" }),
        makeMealType({ name: "Dinner" }),
      ]);
    });

    it("finds exact match case-insensitively", () => {
      expect(store.resolveByName("dinner")?.name).toBe("Dinner");
      expect(store.resolveByName("DINNER")?.name).toBe("Dinner");
      expect(store.resolveByName("Dinner")?.name).toBe("Dinner");
    });

    it("returns undefined for unknown name", () => {
      expect(store.resolveByName("Brunch")).toBeUndefined();
    });
  });
});
