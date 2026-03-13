import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseDuration, formatDuration } from "./duration.js";

describe("Duration property-based tests", () => {
  describe("duration-helper.AC7.4: Roundtrip stability", () => {
    it("Property 1: For any valid duration (positive integer minutes), parsing and formatting should produce a non-empty string", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10000 }), (minutes) => {
          parseDuration(minutes).match(
            (duration) => {
              expect(formatDuration(duration)).not.toBe("");
            },
            () => {
              expect.fail("Expected Ok but got Err");
            },
          );
        }),
      );
    });

    it("Property 2: Idempotence of formatting - parsing a formatted string and re-formatting should yield the same string", () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 10000 }), (minutes) => {
          parseDuration(minutes).match(
            (d1) => {
              const formatted1 = formatDuration(d1);
              parseDuration(formatted1).match(
                (d2) => {
                  expect(formatted1).toBe(formatDuration(d2));
                },
                () => {
                  expect.fail("Expected Ok for re-parsed duration but got Err");
                },
              );
            },
            () => {
              expect.fail("Expected Ok but got Err");
            },
          );
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

            parseDuration(num).match(
              (duration) => {
                expect(duration.as("minutes")).toBeCloseTo(num, 5);
              },
              () => {
                expect.fail("Expected Ok but got Err");
              },
            );
          },
        ),
      );
    });
  });
});
