import { describe, it, expect } from "vitest";
import { DateTime } from "luxon";
import { parseInputDate, toWireDateFormat } from "./dates.js";

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
});
