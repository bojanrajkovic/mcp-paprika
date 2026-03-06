import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseDuration, formatDuration } from "./duration.js";

describe("Duration property-based tests", () => {
  describe("duration-helper.AC7.4: Roundtrip stability", () => {
    it("Property 1: For any valid duration (positive integer minutes), parsing and formatting should produce a non-empty string", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10000 }), (minutes) => {
          const result = parseDuration(minutes);

          expect(result.isOk()).toBe(true);
          if (result.isOk()) {
            const formatted = formatDuration(result.value);
            expect(formatted).not.toBe("");
          }
        }),
      );
    });

    it("Property 2: Idempotence of formatting - parsing a formatted string and re-formatting should yield the same string", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10000 }), (minutes) => {
          const result1 = parseDuration(minutes);

          expect(result1.isOk()).toBe(true);
          if (result1.isOk()) {
            const formatted1 = formatDuration(result1.value);
            const result2 = parseDuration(formatted1);

            expect(result2.isOk()).toBe(true);
            if (result2.isOk()) {
              const formatted2 = formatDuration(result2.value);
              expect(formatted1).toBe(formatted2);
            }
          }
        }),
      );
    });

    it("Property 3: Numeric parse preserves value - for any non-negative finite number, parseDuration(n) returns Ok with Duration whose as('minutes') equals the input", () => {
      fc.assert(
        fc.property(
          fc.double({
            min: 0,
            max: 100000,
            noNaN: true,
          }),
          (num) => {
            // Filter out Infinity
            if (!Number.isFinite(num)) {
              return;
            }

            const result = parseDuration(num);

            expect(result.isOk()).toBe(true);
            if (result.isOk()) {
              const minutes = result.value.as("minutes");
              expect(minutes).toBeCloseTo(num, 5);
            }
          },
        ),
      );
    });
  });
});
