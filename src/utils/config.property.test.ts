import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { paprikaConfigSchema } from "./config.js";

describe("Config property-based tests", () => {
  describe("Boolean field idempotence", () => {
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

  describe("Duration field", () => {
    it("Property 3: a compound h/m/s duration parses to the sum of its parts, in ms", () => {
      fc.assert(
        fc.property(fc.nat(48), fc.nat(59), fc.nat(59), (h, m, sec) => {
          fc.pre(h + m + sec > 0);
          const text = `${h > 0 ? `${h.toString()}h` : ""}${m > 0 ? `${m.toString()}m` : ""}${sec > 0 ? `${sec.toString()}s` : ""}`;
          const result = paprikaConfigSchema.safeParse({
            paprika: { email: "user@test.com", password: "secret" },
            sync: { interval: text },
          });

          expect(result.success).toBe(true);
          if (result.success) {
            expect(result.data.sync.interval).toBe(((h * 60 + m) * 60 + sec) * 1000);
          }
        }),
      );
    });
  });
});
