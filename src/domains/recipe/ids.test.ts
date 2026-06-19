import { describe, expect, it } from "vitest";

import { CategoryUidSchema, PhotoUidSchema, RecipeUidSchema } from "./ids.js";

// Branding is compile-time only; the one runtime invariant every
// brand carries is non-emptiness, so a dropped `.min(1)` fails here rather
// than as a distant parse error during sync. How a foreign key spells absence
// lives in docs/architecture.md (Identifiers).
describe("recipe ids: every primary-key brand rejects the empty string", () => {
  const PK_SCHEMAS = { CategoryUidSchema, PhotoUidSchema, RecipeUidSchema };

  for (const [name, schema] of Object.entries(PK_SCHEMAS)) {
    it(`${name} rejects "" and accepts a non-empty UID`, () => {
      expect(() => schema.parse("")).toThrow();
      expect(schema.parse("A1")).toBe("A1");
    });
  }
});

describe("recipe ids: a nullable foreign key spells absence as null", () => {
  it("accepts null and a non-empty UID, but still rejects the empty string", () => {
    const schema = RecipeUidSchema.nullable();
    expect(schema.parse(null)).toBeNull();
    expect(schema.parse("R-1")).toBe("R-1");
    expect(() => schema.parse("")).toThrow();
  });
});
