import { describe, expect, it } from "vitest";

import { MealTypeUidSchema } from "./ids.js";

// Branding is compile-time only (ADR-0007); the one runtime invariant every
// brand carries is non-emptiness, so a dropped `.min(1)` fails here rather
// than as a distant parse error during sync. How a foreign key spells absence
// lives in docs/architecture.md (Identifiers).
describe("meal-type ids: every primary-key brand rejects the empty string", () => {
  const PK_SCHEMAS = { MealTypeUidSchema };

  for (const [name, schema] of Object.entries(PK_SCHEMAS)) {
    it(`${name} rejects "" and accepts a non-empty UID`, () => {
      expect(() => schema.parse("")).toThrow();
      expect(schema.parse("A1")).toBe("A1");
    });
  }
});
