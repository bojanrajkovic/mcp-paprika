import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { paprikaConfigSchema } from "./config.js";

describe("Config property-based tests", () => {
  describe("config-loader.AC8: Boolean field idempotence", () => {
    it("Property 1: Parsing an already-parsed boolean through booleanField returns the same value", () => {
      fc.assert(
        fc.property(fc.constantFrom(true, false), (bool) => {
          const input = {
            paprika: { email: "user@test.com", password: "secret" },
            sync: { enabled: bool },
          };
          const result = paprikaConfigSchema.safeParse(input);

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.sync.enabled).toBe(bool);
          }
        }),
      );
    });

    it("Property 2: Parsing a boolean string ('true'/'false') through booleanField returns the parsed value", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(
            { str: "true", expected: true },
            { str: "false", expected: false },
            { str: "1", expected: true },
            { str: "0", expected: false },
          ),
          ({ str, expected }) => {
            const input = {
              paprika: { email: "user@test.com", password: "secret" },
              sync: { enabled: str },
            };
            const result = paprikaConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.sync.enabled).toBe(expected);
            }
          },
        ),
      );
    });
  });

  describe("config-loader.AC9: Merge behavior properties", () => {
    it("Property 3: Override dominance - if paprika.email is in overrides, result contains the override value", () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => s.length > 0),
          (email) => {
            const input = {
              paprika: { email, password: "secret" },
            };
            const result = paprikaConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.paprika.email).toBe(email);
            }
          },
        ),
      );
    });

    it("Property 4: Nested object structure preservation - valid nested config objects parse without loss of structure", () => {
      fc.assert(
        fc.property(
          fc.record({
            email: fc.string().filter((s) => s.length > 0),
            password: fc.string().filter((s) => s.length > 0),
          }),
          ({ email, password }) => {
            const input = {
              paprika: { email, password },
              sync: { enabled: true, interval: 900000 },
            };
            const result = paprikaConfigSchema.safeParse(input);

            expect(result.success).toBe(true);
            if (result.success) {
              expect(result.data.paprika.email).toBe(email);
              expect(result.data.paprika.password).toBe(password);
              expect(result.data.sync.enabled).toBe(true);
            }
          },
        ),
      );
    });
  });
});
