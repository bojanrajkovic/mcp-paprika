import { describe, it, expect, beforeEach } from "vitest";
import { GroceryIngredientStore } from "./store.js";
import { makeGroceryIngredient } from "../cache/__fixtures__/grocery-ingredients.js";

describe("GroceryIngredientStore", () => {
  let store: GroceryIngredientStore;

  beforeEach(() => {
    store = new GroceryIngredientStore();
  });

  describe("grocery-infra.AC1.7: lookupByName resolves case-insensitively", () => {
    it("grocery-infra.AC1.7: lookupByName('butter') finds ingredient named 'Butter'", () => {
      const ingredient = makeGroceryIngredient({
        name: "Butter",
        aisleUid: "aisle-dairy",
      });
      store.load([ingredient]);

      const result = store.lookupByName("butter");

      expect(result).toBeDefined();
      expect(result?.aisleUid).toBe("aisle-dairy");
      expect(result?.name).toBe("Butter");
    });

    it("grocery-infra.AC1.7: lookupByName('BUTTER') finds ingredient named 'Butter'", () => {
      const ingredient = makeGroceryIngredient({ name: "Butter" });
      store.load([ingredient]);

      const result = store.lookupByName("BUTTER");

      expect(result).toBeDefined();
      expect(result?.name).toBe("Butter");
    });

    it("grocery-infra.AC1.7: lookupByName('Butter') (exact case) finds ingredient named 'Butter'", () => {
      const ingredient = makeGroceryIngredient({ name: "Butter" });
      store.load([ingredient]);

      const result = store.lookupByName("Butter");

      expect(result).toBeDefined();
      expect(result?.name).toBe("Butter");
    });
  });

  describe("grocery-infra.AC1.10: lookupByName returns undefined for unknown names", () => {
    it("grocery-infra.AC1.10: lookupByName returns undefined for unknown ingredient after load", () => {
      const ingredient = makeGroceryIngredient({ name: "Butter" });
      store.load([ingredient]);

      const result = store.lookupByName("nonexistent");

      expect(result).toBeUndefined();
    });

    it("grocery-infra.AC1.10: lookupByName returns undefined on empty (unsynced) store", () => {
      const result = store.lookupByName("anything");

      expect(result).toBeUndefined();
    });
  });

  describe("basic behavior", () => {
    it("hasSynced is false before load()", () => {
      expect(store.hasSynced).toBe(false);
    });

    it("load() sets hasSynced to true", () => {
      store.load([makeGroceryIngredient()]);

      expect(store.hasSynced).toBe(true);
    });

    it("load([]) sets hasSynced to true with empty store", () => {
      store.load([]);

      expect(store.hasSynced).toBe(true);
      expect(store.size).toBe(0);
    });

    it("load() replaces previous contents", () => {
      const first = makeGroceryIngredient({ name: "OldIngredient" });
      store.load([first]);
      expect(store.size).toBe(1);

      const second = makeGroceryIngredient({ name: "NewIngredient" });
      store.load([second]);

      expect(store.size).toBe(1);
      expect(store.lookupByName("OldIngredient")).toBeUndefined();
      expect(store.lookupByName("NewIngredient")).toBeDefined();
    });

    it("size reflects item count after load", () => {
      store.load([
        makeGroceryIngredient({ name: "Apple" }),
        makeGroceryIngredient({ name: "Banana" }),
        makeGroceryIngredient({ name: "Cherry" }),
      ]);

      expect(store.size).toBe(3);
    });

    it("getAll() returns all loaded items", () => {
      const item1 = makeGroceryIngredient({ name: "Apple" });
      const item2 = makeGroceryIngredient({ name: "Banana" });
      store.load([item1, item2]);

      const all = store.getAll();

      expect(all).toHaveLength(2);
      expect(all).toEqual(expect.arrayContaining([item1, item2]));
    });
  });
});
