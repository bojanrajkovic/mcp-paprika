import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { paprikaConfigSchema, deepMerge } from "./config.js";

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
    it("Property 3: deepMerge identity - merging base with empty overrides returns deep-equal base", () => {
      fc.assert(
        fc.property(fc.object(), (base) => {
          const result = deepMerge(base as Record<string, unknown>, {});
          expect(result).toEqual(base);
        }),
      );
    });

    it("Property 4: deepMerge override dominance - every top-level key in overrides appears in result", () => {
      fc.assert(
        fc.property(fc.object(), fc.object(), (base, overrides) => {
          const result = deepMerge(base as Record<string, unknown>, overrides as Record<string, unknown>);
          for (const key of Object.keys(overrides)) {
            expect(key in result).toBe(true);
          }
        }),
      );
    });
  });
});
