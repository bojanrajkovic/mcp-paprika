import { describe, expect, it } from "vitest";

import type { MealTypeUid } from "./ids.js";

import { mealTypeSpecSchema } from "./meal-type-helpers.js";

describe("mealTypeSpecSchema", () => {
  it("parses {name} variant and trims whitespace", () => {
    expect(mealTypeSpecSchema.parse({ name: "  Dinner  " })).toEqual({ name: "Dinner" });
    expect(mealTypeSpecSchema.parse({ name: "Breakfast" })).toEqual({ name: "Breakfast" });
  });

  it("parses {uid} variant", () => {
    const uid = "meal-type-uid-123" as MealTypeUid;
    expect(mealTypeSpecSchema.parse({ uid })).toEqual({ uid });
  });

  it("parses {builtin} variant for values 0–3", () => {
    for (const v of [0, 1, 2, 3]) {
      expect(mealTypeSpecSchema.parse({ builtin: v })).toEqual({ builtin: v });
    }
  });

  it("rejects {name} with empty string", () => {
    expect(() => mealTypeSpecSchema.parse({ name: "" })).toThrow();
  });

  it("rejects {builtin: 4} (out of range)", () => {
    expect(() => mealTypeSpecSchema.parse({ builtin: 4 })).toThrow();
  });

  it("rejects {builtin: -1} (out of range)", () => {
    expect(() => mealTypeSpecSchema.parse({ builtin: -1 })).toThrow();
  });

  it("rejects ambiguous shape {name, uid}", () => {
    expect(() => mealTypeSpecSchema.parse({ name: "Dinner", uid: "some-uid" })).toThrow();
  });

  it("rejects unknown shape", () => {
    expect(() => mealTypeSpecSchema.parse({ kind: "builtin", value: 2 })).toThrow();
  });
});
