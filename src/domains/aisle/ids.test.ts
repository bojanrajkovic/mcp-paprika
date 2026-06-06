import { describe, expect, it } from "vitest";

import { type AisleUid, AisleUidRef, AisleUidSchema, NO_AISLE_UID, NoAisleRef } from "./ids.js";

// Branding is compile-time only (ADR-0007); the one runtime invariant every
// brand carries is non-emptiness, so a dropped `.min(1)` fails here rather
// than as a distant parse error during sync. How a foreign key spells absence
// lives in docs/architecture.md (Identifiers).
describe("aisle ids: every primary-key brand rejects the empty string", () => {
  const PK_SCHEMAS = { AisleUidSchema };

  for (const [name, schema] of Object.entries(PK_SCHEMAS)) {
    it(`${name} rejects "" and accepts a non-empty UID`, () => {
      expect(() => schema.parse("")).toThrow();
      expect(schema.parse("A1")).toBe("A1");
    });
  }
});

describe("aisle ids: the no-aisle foreign-key sentinel", () => {
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
