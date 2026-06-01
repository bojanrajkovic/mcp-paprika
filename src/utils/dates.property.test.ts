import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { DateTime } from "luxon";
import { parseCalendarDayWire, parseInstant } from "./dates.js";

// The wire format a UTC DateTime renders to. parseInstant consumes this shape;
// the deleted `toWireDateFormat` helper used to produce it, so these properties
// build it inline (`dt.toUTC().toFormat(...)`) to keep parseInstant's round-trip
// coverage without resurrecting a dead export.
const WIRE_FORMAT = "yyyy-MM-dd HH:mm:ss";

describe("dates.ts property-based tests", () => {
  describe("Property 1: Round-trip — wire format input", () => {
    it("For any valid yyyy-MM-dd HH:mm:ss string, parseInstant(s) re-renders to s in UTC", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1970, max: 2100 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }),
          fc.integer({ min: 0, max: 23 }),
          fc.integer({ min: 0, max: 59 }),
          fc.integer({ min: 0, max: 59 }),
          (year, month, day, hour, minute, second) => {
            const s =
              [String(year).padStart(4, "0"), String(month).padStart(2, "0"), String(day).padStart(2, "0")].join("-") +
              " " +
              [String(hour).padStart(2, "0"), String(minute).padStart(2, "0"), String(second).padStart(2, "0")].join(
                ":",
              );
            const parsed = parseInstant(s);
            expect(parsed).not.toBeNull();
            // parsed is already UTC, so toFormat renders the original string back.
            expect(parsed!.toFormat(WIRE_FORMAT)).toBe(s);
          },
        ),
      );
    });
  });

  describe("Property 2: UTC preservation", () => {
    it("For any DateTime in an arbitrary IANA zone, parseInstant(<its UTC wire string>) preserves the UTC instant (truncated to second)", () => {
      const ianaZones = fc.constantFrom(
        "UTC",
        "America/New_York",
        "Europe/London",
        "Asia/Tokyo",
        "Australia/Sydney",
        "Pacific/Auckland",
      );

      fc.assert(
        fc.property(
          fc.integer({ min: 1970, max: 2100 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }),
          fc.integer({ min: 0, max: 23 }),
          fc.integer({ min: 0, max: 59 }),
          fc.integer({ min: 0, max: 59 }),
          ianaZones,
          (year, month, day, hour, minute, second, zone) => {
            const dt = DateTime.fromObject({ year, month, day, hour, minute, second }, { zone });
            // Skip invalid DateTime combinations (e.g., DST gaps)
            if (!dt.isValid) return;

            const wire = dt.toUTC().toFormat(WIRE_FORMAT);
            const reparsed = parseInstant(wire);
            expect(reparsed).not.toBeNull();
            // The wire format has no sub-second precision, so compare at second granularity
            expect(reparsed!.toMillis()).toBe(dt.toUTC().startOf("second").toMillis());
          },
        ),
      );
    });
  });

  describe("Property 3: Null on malformed input", () => {
    it("For arbitrary strings that do not parse as dates, parseInstant returns null rather than throwing", () => {
      fc.assert(
        fc.property(
          fc.string().filter((s) => parseInstant(s) === null),
          (s) => {
            // Should return null, not throw
            expect(parseInstant(s)).toBeNull();
          },
        ),
      );
    });
  });

  describe("Property 4: parseCalendarDayWire honors the input's embedded offset", () => {
    it("For any local DateTime t in an arbitrary IANA zone, parseCalendarDayWire(t.toISO()) yields a wire string whose date portion matches t's local calendar day", () => {
      // Property 2 above tested UTC-instant preservation through parseInstant;
      // this property tests the meal-write contract that parseCalendarDayWire
      // preserves the user's LOCAL calendar day regardless of UTC shift. Without
      // this property, the TZ-offset drift bug (US-Pacific evening DateTime ending
      // up on the next UTC day) would not be caught by fast-check.
      const ianaZones = fc.constantFrom(
        "UTC",
        "America/Los_Angeles", // UTC-8 / UTC-7 — the canonical "evening crosses UTC midnight" zone
        "America/New_York",
        "Europe/London",
        "Asia/Tokyo", // UTC+9 — the canonical "early morning crosses UTC midnight backward" zone
        "Pacific/Auckland",
      );

      fc.assert(
        fc.property(
          fc.integer({ min: 1970, max: 2100 }),
          fc.integer({ min: 1, max: 12 }),
          fc.integer({ min: 1, max: 28 }),
          fc.integer({ min: 0, max: 23 }),
          fc.integer({ min: 0, max: 59 }),
          fc.integer({ min: 0, max: 59 }),
          ianaZones,
          (year, month, day, hour, minute, second, zone) => {
            const dt = DateTime.fromObject({ year, month, day, hour, minute, second }, { zone });
            if (!dt.isValid) return; // skip DST gaps
            const iso = dt.toISO();
            if (iso === null) return;

            const wire = parseCalendarDayWire(iso);
            expect(wire).not.toBeNull();
            // Wire date portion equals the input DT's local calendar day, not
            // its UTC-shifted day. The time portion is always midnight.
            expect(wire).toBe(`${dt.toFormat("yyyy-MM-dd")} 00:00:00`);
          },
        ),
      );
    });
  });
});
