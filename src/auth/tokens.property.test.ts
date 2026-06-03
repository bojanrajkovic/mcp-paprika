import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { generateOpaqueToken, hashTokenForStorage } from "./tokens.js";

describe("tokens: property-based tests", () => {
  describe("generateOpaqueToken properties", () => {
    it("Property 1: For any valid token prefix, generated token starts with that prefix", () => {
      const prefixes = ["mcp_at_", "mcp_rt_", "mcp_ac_", "mcp_rat_", "mcp_state_", "mcp_nonce_"] as const;

      fc.assert(
        fc.property(fc.constantFrom(...prefixes), (prefix) => {
          const token = generateOpaqueToken(prefix);
          expect(token.startsWith(prefix)).toBe(true);
        }),
      );
    });
  });

  describe("hashTokenForStorage properties", () => {
    it("Property 1: For any string, hash always matches the pattern of 64 lowercase hex characters", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const hash = hashTokenForStorage(input);
          expect(hash).toMatch(/^[0-9a-f]{64}$/);
        }),
      );
    });

    it("Property 2: For any string, hash is deterministic (same input produces same output)", () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          const hash1 = hashTokenForStorage(input);
          const hash2 = hashTokenForStorage(input);
          expect(hash1).toBe(hash2);
        }),
      );
    });

    it("Property 3: For distinct strings, hash differs (collision resistance — observed with overwhelming probability)", () => {
      fc.assert(
        fc.property(
          fc.tuple(fc.string(), fc.string()).filter(([a, b]) => a !== b),
          ([input1, input2]) => {
            const hash1 = hashTokenForStorage(input1);
            const hash2 = hashTokenForStorage(input2);
            // SHA-256 collisions are astronomically rare, so this assertion is safe
            expect(hash1).not.toBe(hash2);
          },
        ),
      );
    });
  });
});
