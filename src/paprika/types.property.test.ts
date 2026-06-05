import fc from "fast-check";
import { describe, expect, it } from "vitest";

import type { GroceryIngredientUid, GroceryItemUid, GroceryListUid, MenuItemUid, MenuUid } from "../ids.js";

import { GroceryIngredientStoredSchema } from "../domains/grocery/grocery-ingredient/types.js";
import { GroceryItemStoredSchema } from "../domains/grocery/grocery-item/types.js";
import { GroceryListStoredSchema } from "../domains/grocery/grocery-list/types.js";
import { MenuItemStoredSchema } from "../domains/menu/menu-item/types.js";
import { MenuStoredSchema } from "../domains/menu/types.js";

describe("Grocery schema property-based tests", () => {
  describe("GroceryList stored schema idempotent round-trip", () => {
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

  describe("GroceryItem stored schema idempotent round-trip", () => {
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
            listUid: fc.string({ minLength: 1 }),
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

  describe("GroceryIngredient stored schema idempotent round-trip", () => {
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

  describe("Menu stored schema idempotent round-trip", () => {
    it("Property: parsing a valid Menu through MenuStoredSchema is idempotent", () => {
      fc.assert(
        fc.property(
          fc.record({
            uid: fc.string({ minLength: 1 }).map((s) => s as MenuUid),
            name: fc.string(),
            days: fc.integer({ min: 0, max: 60 }),
            orderFlag: fc.integer({ min: 0, max: 100 }),
            notes: fc.string(),
            deleted: fc.boolean(),
          }),
          (menu) => {
            const first = MenuStoredSchema.safeParse(menu);
            expect(first.success).toBe(true);
            if (!first.success) return;

            const second = MenuStoredSchema.safeParse(first.data);
            expect(second.success).toBe(true);
            if (second.success) {
              expect(second.data).toEqual(first.data);
            }
          },
        ),
      );
    });
  });

  describe("MenuItem stored schema idempotent round-trip", () => {
    it("Property: parsing a valid MenuItem through MenuItemStoredSchema is idempotent (nullable menuUid/recipeUid)", () => {
      fc.assert(
        fc.property(
          fc.record({
            uid: fc.string({ minLength: 1 }).map((s) => s as MenuItemUid),
            menuUid: fc.oneof(fc.constant(null), fc.string({ minLength: 1 })),
            recipeUid: fc.oneof(fc.constant(null), fc.string({ minLength: 1 })),
            name: fc.string(),
            day: fc.integer({ min: 0, max: 60 }),
            typeUid: fc.string({ minLength: 1 }),
            orderFlag: fc.integer({ min: 0, max: 100 }),
            deleted: fc.boolean(),
          }),
          (item) => {
            const first = MenuItemStoredSchema.safeParse(item);
            expect(first.success).toBe(true);
            if (!first.success) return;

            const second = MenuItemStoredSchema.safeParse(first.data);
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
