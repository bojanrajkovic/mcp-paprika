import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { contentHash } from "./vector-store.js";

describe("contentHash property-based tests", () => {
  describe("AC5.1: Determinism and format properties", () => {
    it("Property 1: For any string input, contentHash(s) === contentHash(s) (determinism)", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const hash1 = contentHash(input);
          const hash2 = contentHash(input);
          expect(hash1).toBe(hash2);
        }),
      );
    });

    it("Property 2: Output is always a 64-character hex string", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const hash = contentHash(input);
          expect(hash).toMatch(/^[0-9a-f]{64}$/);
        }),
      );
    });

    it("Property 3: For any two distinct non-empty strings a !== b, contentHash(a) !== contentHash(b) (collision resistance)", () => {
      fc.assert(
        fc.property(fc.string(), fc.string(), (a, b) => {
          // Only test when strings are distinct
          fc.pre(a !== b);

          const hashA = contentHash(a);
          const hashB = contentHash(b);
          expect(hashA).not.toBe(hashB);
        }),
      );
    });

    it("Property 4: Empty string produces a valid 64-character hex hash", () => {
      const hash = contentHash("");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
