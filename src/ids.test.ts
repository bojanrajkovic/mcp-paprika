import { describe, it, expect } from "vitest";

import {
  RecipeUidSchema,
  RecipeUidRefSchema,
  MenuUidSchema,
  MenuUidRefSchema,
  GroceryListUidSchema,
  GroceryListUidRefSchema,
  AisleUidSchema,
  NO_AISLE_UID,
  type RecipeUid,
  type MenuUid,
  type GroceryListUid,
} from "./ids.js";

// The FK-reference schemas (`*RefSchema`) carry the SAME brand as their
// primary-key schema (so an FK field stays assignment-compatible with a
// PK-typed value) but drop the PK's `.min(1)` (so an empty / "no reference"
// foreign key still parses). That pairing is otherwise only a convention in
// ids.ts; these tests lock it, so a future #202 tightening that forgets a ref —
// or a brand-string drift — fails here rather than as distant type errors.
describe("ids: FK reference schemas vs primary-key schemas", () => {
  it("ref schemas accept the empty foreign-key sentinel; PK schemas reject it", () => {
    for (const ref of [RecipeUidRefSchema, MenuUidRefSchema, GroceryListUidRefSchema]) {
      expect(ref.parse("")).toBe("");
    }
    for (const pk of [RecipeUidSchema, MenuUidSchema, GroceryListUidSchema]) {
      expect(() => pk.parse("")).toThrow();
    }
  });

  it("a ref schema's output is assignable to its PK brand (same brand)", () => {
    // Compile-time guard: if the paired brand strings ever drift, these
    // assignments stop type-checking and the build fails.
    const recipe: RecipeUid = RecipeUidRefSchema.parse("R-1");
    const menu: MenuUid = MenuUidRefSchema.parse("M-1");
    const list: GroceryListUid = GroceryListUidRefSchema.parse("L-1");
    expect([recipe, menu, list]).toEqual(["R-1", "M-1", "L-1"]);
  });

  it("NO_AISLE_UID is the empty AisleUid sentinel and round-trips through AisleUidSchema", () => {
    expect(NO_AISLE_UID).toBe("");
    expect(AisleUidSchema.parse(NO_AISLE_UID)).toBe("");
  });
});
