import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  GroceryListStoredSchema,
  GroceryItemStoredSchema,
  GroceryIngredientStoredSchema,
  type GroceryListUid,
  type GroceryItemUid,
  type GroceryIngredientUid,
} from "./types.js";

describe("Grocery schema property-based tests", () => {
  describe("grocery-infra.AC1.1: GroceryList stored schema idempotent round-trip", () => {
    it("Property: parsing a valid GroceryList through GroceryListStoredSchema is idempotent", () => {
      fc.assert(
        fc.property(
          fc.record({
            uid: fc.string({ minLength: 1 }).map((s) => s as GroceryListUid),
            name: fc.string(),
            orderFlag: fc.integer({ min: 0, max: 100 }),
            isDefault: fc.boolean(),
            remindersList: fc.string(),
            deleted: fc.boolean(),
          }),
          (list) => {
            const first = GroceryListStoredSchema.safeParse(list);
            expect(first.success).toBe(true);
            if (!first.success) return;

            const second = GroceryListStoredSchema.safeParse(first.data);
            expect(second.success).toBe(true);
            if (second.success) {
              expect(second.data).toEqual(first.data);
            }
          },
        ),
      );
    });
  });

  describe("grocery-infra.AC1.2: GroceryItem stored schema idempotent round-trip", () => {
    it("Property: parsing a valid GroceryItem through GroceryItemStoredSchema is idempotent", () => {
      fc.assert(
        fc.property(
          fc.record({
            uid: fc.string({ minLength: 1 }).map((s) => s as GroceryItemUid),
            name: fc.oneof(
              fc.constant(""),
              fc.tuple(fc.string({ minLength: 1 }), fc.string({ minLength: 1 })).map(([q, i]) => `${q} ${i}`),
            ),
            ingredient: fc.string(),
            aisle: fc.string(),
            aisleUid: fc.string(),
            listUid: fc.string(),
            purchased: fc.boolean(),
            deleted: fc.boolean(),
            orderFlag: fc.integer({ min: 0, max: 100 }),
            quantity: fc.string(),
            instruction: fc.string(),
            recipe: fc.oneof(fc.constant(null), fc.string()),
            separate: fc.boolean(),
          }),
          (item) => {
            const first = GroceryItemStoredSchema.safeParse(item);
            expect(first.success).toBe(true);
            if (!first.success) return;

            const second = GroceryItemStoredSchema.safeParse(first.data);
            expect(second.success).toBe(true);
            if (second.success) {
              expect(second.data).toEqual(first.data);
            }
          },
        ),
      );
    });
  });

  describe("grocery-infra.AC1.3: GroceryIngredient stored schema idempotent round-trip", () => {
    it("Property: parsing a valid GroceryIngredient through GroceryIngredientStoredSchema is idempotent", () => {
      fc.assert(
        fc.property(
          fc.record({
            uid: fc.string({ minLength: 1 }).map((s) => s as GroceryIngredientUid),
            name: fc.string(),
            aisleUid: fc.string(),
            deleted: fc.boolean(),
          }),
          (ingredient) => {
            const first = GroceryIngredientStoredSchema.safeParse(ingredient);
            expect(first.success).toBe(true);
            if (!first.success) return;

            const second = GroceryIngredientStoredSchema.safeParse(first.data);
            expect(second.success).toBe(true);
            if (second.success) {
              expect(second.data).toEqual(first.data);
            }
          },
        ),
      );
    });
  });
});
