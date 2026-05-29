import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { parseInputDate, parseInputMealDate, toWireDateFormat } from "./dates.js";

describe("parseInputDate and toWireDateFormat", () => {
  describe("parseInputDate — Paprika wire format (yyyy-MM-dd HH:mm:ss)", () => {
    it("parses wire format string to a valid UTC DateTime", () => {
      const result = parseInputDate("2026-06-15 14:30:00");
      expect(result).not.toBeNull();
      expect(result!.isValid).toBe(true);
      expect(result!.zoneName).toBe("UTC");
      expect(result!.toISO()).toBe("2026-06-15T14:30:00.000Z");
    });
  });

  describe("parseInputDate — RFC-like format (yyyy-MM-dd'T'HH:mm:ss)", () => {
    it("parses RFC-like format string to a valid UTC DateTime", () => {
      const result = parseInputDate("2026-06-15T14:30:00");
      expect(result).not.toBeNull();
      expect(result!.isValid).toBe(true);
      expect(result!.zoneName).toBe("UTC");
      expect(result!.toISO()).toBe("2026-06-15T14:30:00.000Z");
    });
  });

  describe("parseInputDate — date-only format (yyyy-MM-dd)", () => {
    it("parses date-only string to a valid UTC DateTime at midnight", () => {
      const result = parseInputDate("2026-06-15");
      expect(result).not.toBeNull();
      expect(result!.isValid).toBe(true);
      expect(result!.zoneName).toBe("UTC");
      expect(result!.year).toBe(2026);
      expect(result!.month).toBe(6);
      expect(result!.day).toBe(15);
      expect(result!.hour).toBe(0);
      expect(result!.minute).toBe(0);
      expect(result!.second).toBe(0);
    });
  });

  describe("parseInputDate — ISO 8601 with offset", () => {
    it("parses ISO 8601 with timezone offset to the correct UTC instant", () => {
      // 2026-06-15T14:30:00-04:00 is 18:30:00 UTC
      const result = parseInputDate("2026-06-15T14:30:00-04:00");
      expect(result).not.toBeNull();
      expect(result!.isValid).toBe(true);
      expect(result!.toUTC().toISO()).toBe("2026-06-15T18:30:00.000Z");
    });
  });

  describe("parseInputDate — bare ISO without zone", () => {
    it("parses bare ISO datetime without zone as UTC", () => {
      // No zone offset — should be treated as UTC
      const result = parseInputDate("2026-06-15T14:30:00");
      expect(result).not.toBeNull();
      expect(result!.isValid).toBe(true);
      expect(result!.zoneName).toBe("UTC");
      expect(result!.hour).toBe(14);
    });
  });

  describe("parseInputDate — invalid inputs return null", () => {
    it("returns null for empty string", () => {
      expect(parseInputDate("")).toBeNull();
    });

    it("returns null for non-date string", () => {
      expect(parseInputDate("not a date")).toBeNull();
    });

    it("returns null for invalid date components (month 13, day 99)", () => {
      expect(parseInputDate("2026-13-99")).toBeNull();
    });
  });

  describe("toWireDateFormat — round-trip through Paprika wire format", () => {
    it("round-trips a wire format string through parseInputDate and back", () => {
      const original = "2026-06-15 14:30:00";
      const dt = parseInputDate(original);
      expect(dt).not.toBeNull();
      expect(toWireDateFormat(dt!)).toBe(original);
    });
  });

  describe("toWireDateFormat — UTC conversion", () => {
    it("converts a non-UTC DateTime to UTC when formatting", () => {
      // Create a DateTime in America/New_York (UTC-5 in winter, UTC-4 in summer)
      // June is UTC-4, so 10:30 EDT = 14:30 UTC
      const dtEastern = DateTime.fromISO("2026-06-15T10:30:00", { zone: "America/New_York" });
      expect(dtEastern.isValid).toBe(true);
      const formatted = toWireDateFormat(dtEastern);
      expect(formatted).toBe("2026-06-15 14:30:00");
    });
  });

  describe("parseInputMealDate — calendar-day extraction", () => {
    it("returns wire format at midnight for date-only input", () => {
      expect(parseInputMealDate("2026-06-15")).toBe("2026-06-15 00:00:00");
    });

    it("drops time-of-day for a wire-format input", () => {
      expect(parseInputMealDate("2026-06-15 18:30:45")).toBe("2026-06-15 00:00:00");
    });

    it("drops time-of-day for an RFC-like input without offset", () => {
      expect(parseInputMealDate("2026-06-15T18:30:45")).toBe("2026-06-15 00:00:00");
    });

    it("preserves the input's calendar day even when the offset would UTC-shift past midnight (US-Pacific evening)", () => {
      // 2026-06-15T22:00:00-08:00 is 2026-06-16T06:00:00Z. The user typed June 15;
      // they mean June 15. parseInputDate + UTC conversion would store June 16;
      // parseInputMealDate honors the input's embedded offset and stores June 15.
      expect(parseInputMealDate("2026-06-15T22:00:00-08:00")).toBe("2026-06-15 00:00:00");
    });

    it("preserves the input's calendar day for positive offsets (Tokyo early morning)", () => {
      // 2026-06-15T02:00:00+09:00 is 2026-06-14T17:00:00Z. The user typed June 15;
      // UTC conversion would store June 14. We store June 15.
      expect(parseInputMealDate("2026-06-15T02:00:00+09:00")).toBe("2026-06-15 00:00:00");
    });

    it("treats Z-suffix as UTC (which is also a zone, just trivially)", () => {
      // 2026-06-15T22:00:00Z — the embedded zone IS UTC, so the calendar day is June 15.
      expect(parseInputMealDate("2026-06-15T22:00:00Z")).toBe("2026-06-15 00:00:00");
    });

    it("returns null for unparseable input", () => {
      expect(parseInputMealDate("not a date")).toBeNull();
      expect(parseInputMealDate("")).toBeNull();
      expect(parseInputMealDate("2026-13-99")).toBeNull();
    });
  });
});
