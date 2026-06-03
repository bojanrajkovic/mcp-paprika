import { describe, expect, it } from "vitest";

import {
  type AisleUid,
  AisleUidRef,
  AisleUidSchema,
  CategoryUidSchema,
  GroceryIngredientUidSchema,
  GroceryItemUidSchema,
  GroceryListUidSchema,
  MealTypeUidSchema,
  MealUidSchema,
  MenuItemUidSchema,
  MenuUidSchema,
  NO_AISLE_UID,
  NoAisleRef,
  PantryItemUidSchema,
  PhotoUidSchema,
  RecipeUidSchema,
} from "./ids.js";

// Branding is compile-time only (ADR-0007); the one runtime invariant every
// brand carries is non-emptiness. Absence is spelled explicitly: a nullable FK
// uses `.nullable()`, and the grocery "no aisle" reference is the named
// `AisleUidRef` / `NoAisleRef` empty-string sentinel — never a min-less twin of
// the brand. These tests lock that contract, so a regression (a dropped `.min(1)`,
// or an `aisle_uid` field that forgets the sentinel) fails here rather than as a
// distant parse error during sync.
describe("ids: every primary-key brand rejects the empty string", () => {
  const PK_SCHEMAS = {
    RecipeUidSchema,
    CategoryUidSchema,
    AisleUidSchema,
    PantryItemUidSchema,
    GroceryListUidSchema,
    GroceryItemUidSchema,
    GroceryIngredientUidSchema,
    MealUidSchema,
    MealTypeUidSchema,
    MenuUidSchema,
    MenuItemUidSchema,
    PhotoUidSchema,
  };

  for (const [name, schema] of Object.entries(PK_SCHEMAS)) {
    it(`${name} rejects "" and accepts a non-empty UID`, () => {
      expect(() => schema.parse("")).toThrow();
      expect(schema.parse("A1")).toBe("A1");
    });
  }
});

describe("ids: the no-aisle foreign-key sentinel", () => {
  it("NO_AISLE_UID is the empty string; it parses through AisleUidRef but NOT the PK schema", () => {
    expect(NO_AISLE_UID).toBe("");
    expect(AisleUidRef.parse(NO_AISLE_UID)).toBe("");
    expect(() => AisleUidSchema.parse(NO_AISLE_UID)).toThrow();
  });

  it("AisleUidRef accepts both a real aisle UID and the empty sentinel", () => {
    expect(AisleUidRef.parse("AISLE-1")).toBe("AISLE-1");
    expect(AisleUidRef.parse("")).toBe("");
  });

  it("NoAisleRef accepts only the empty string", () => {
    expect(NoAisleRef.parse("")).toBe("");
    expect(() => NoAisleRef.parse("AISLE-1")).toThrow();
  });

  it("an AisleUidRef value is assignable to the AisleUid brand (same brand)", () => {
    // Compile-time guard: if NoAisleRef / AisleUidRef ever drift off the AisleUid
    // brand, these assignments stop type-checking and the build fails.
    const sentinel: AisleUid = AisleUidRef.parse("");
    const real: AisleUid = AisleUidRef.parse("AISLE-1");
    expect([sentinel, real]).toEqual(["", "AISLE-1"]);
  });
});

describe("ids: a nullable foreign key spells absence as null", () => {
  it("accepts null and a non-empty UID, but still rejects the empty string", () => {
    const schema = RecipeUidSchema.nullable();
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse("R-1")).toBe("R-1");
    expect(() => schema.parse("")).toThrow();
  });
});
