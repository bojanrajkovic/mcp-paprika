import { describe, expect, it } from "vitest";

import type { MealTypeUid } from "./ids.js";

import { formatMealTypeResolveError, mealTypeSpecSchema } from "./meal-type-helpers.js";

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

describe("formatMealTypeResolveError", () => {
  it("renders the unknown-name message with the known types and discriminator hint", () => {
    const message = formatMealTypeResolveError({
      ok: false,
      reason: "unknown_name",
      name: "Linner",
      knownNames: ["Breakfast", "Dinner"],
    });
    expect(message).toContain('Unknown meal type "Linner"');
    expect(message).toContain("Breakfast, Dinner");
  });

  it("renders the unknown-uid and unknown-builtin messages", () => {
    expect(formatMealTypeResolveError({ ok: false, reason: "unknown_uid", uid: "X" })).toContain('UID "X"');
    expect(formatMealTypeResolveError({ ok: false, reason: "unknown_builtin", index: 9 })).toContain("index 9");
  });
});
