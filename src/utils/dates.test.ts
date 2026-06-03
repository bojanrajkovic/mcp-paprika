import { describe, expect, it } from "vitest";

import {
  formatCalendarDayWire,
  formatTimestampWire,
  normalizeWire,
  parseCalendarDay,
  parseCalendarDayWire,
  parseInstant,
  todayWire,
} from "./dates.js";

describe("parseInstant — UTC-instant parsing", () => {
  describe("Paprika wire format (yyyy-MM-dd HH:mm:ss)", () => {
    it("parses wire format string to a valid UTC DateTime", () => {
      const result = parseInstant("2026-06-15 14:30:00");
      expect(result).not.toBeNull();
      expect(result!.isValid).toBe(true);
      expect(result!.zoneName).toBe("UTC");
      expect(result!.toISO()).toBe("2026-06-15T14:30:00.000Z");
    });
  });

  describe("RFC-like format (yyyy-MM-dd'T'HH:mm:ss)", () => {
    it("parses RFC-like format string to a valid UTC DateTime", () => {
      const result = parseInstant("2026-06-15T14:30:00");
      expect(result).not.toBeNull();
      expect(result!.isValid).toBe(true);
      expect(result!.zoneName).toBe("UTC");
      expect(result!.toISO()).toBe("2026-06-15T14:30:00.000Z");
    });
  });

  describe("date-only format (yyyy-MM-dd)", () => {
    it("parses date-only string to a valid UTC DateTime at midnight", () => {
      const result = parseInstant("2026-06-15");
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

  describe("ISO 8601 with offset", () => {
    it("parses ISO 8601 with timezone offset to the correct UTC instant", () => {
      // 2026-06-15T14:30:00-04:00 is 18:30:00 UTC
      const result = parseInstant("2026-06-15T14:30:00-04:00");
      expect(result).not.toBeNull();
      expect(result!.isValid).toBe(true);
      expect(result!.toUTC().toISO()).toBe("2026-06-15T18:30:00.000Z");
    });
  });

  describe("bare ISO without zone", () => {
    it("parses bare ISO datetime without zone as UTC", () => {
      // No zone offset — should be treated as UTC
      const result = parseInstant("2026-06-15T14:30:00");
      expect(result).not.toBeNull();
      expect(result!.isValid).toBe(true);
      expect(result!.zoneName).toBe("UTC");
      expect(result!.hour).toBe(14);
    });
  });

  describe("invalid inputs return null", () => {
    it("returns null for empty string", () => {
      expect(parseInstant("")).toBeNull();
    });

    it("returns null for non-date string", () => {
      expect(parseInstant("not a date")).toBeNull();
    });

    it("returns null for invalid date components (month 13, day 99)", () => {
      expect(parseInstant("2026-13-99")).toBeNull();
    });
  });
});

describe("parseCalendarDayWire — calendar-day extraction", () => {
  it("returns wire format at midnight for date-only input", () => {
    expect(parseCalendarDayWire("2026-06-15")).toBe("2026-06-15 00:00:00");
  });

  it("drops time-of-day for a wire-format input", () => {
    expect(parseCalendarDayWire("2026-06-15 18:30:45")).toBe("2026-06-15 00:00:00");
  });

  it("drops time-of-day for an RFC-like input without offset", () => {
    expect(parseCalendarDayWire("2026-06-15T18:30:45")).toBe("2026-06-15 00:00:00");
  });

  it("preserves the input's calendar day even when the offset would UTC-shift past midnight (US-Pacific evening)", () => {
    // 2026-06-15T22:00:00-08:00 is 2026-06-16T06:00:00Z. The user typed June 15;
    // they mean June 15. parseInstant + UTC conversion would store June 16;
    // parseCalendarDayWire honors the input's embedded offset and stores June 15.
    expect(parseCalendarDayWire("2026-06-15T22:00:00-08:00")).toBe("2026-06-15 00:00:00");
  });

  it("preserves the input's calendar day for positive offsets (Tokyo early morning)", () => {
    // 2026-06-15T02:00:00+09:00 is 2026-06-14T17:00:00Z. The user typed June 15;
    // UTC conversion would store June 14. We store June 15.
    expect(parseCalendarDayWire("2026-06-15T02:00:00+09:00")).toBe("2026-06-15 00:00:00");
  });

  it("treats Z-suffix as UTC (which is also a zone, just trivially)", () => {
    // 2026-06-15T22:00:00Z — the embedded zone IS UTC, so the calendar day is June 15.
    expect(parseCalendarDayWire("2026-06-15T22:00:00Z")).toBe("2026-06-15 00:00:00");
  });

  it("returns null for unparseable input", () => {
    expect(parseCalendarDayWire("not a date")).toBeNull();
    expect(parseCalendarDayWire("")).toBeNull();
    expect(parseCalendarDayWire("2026-13-99")).toBeNull();
  });
});

describe("parseCalendarDay + formatCalendarDayWire", () => {
  it("parseCalendarDay returns a DateTime carrying the typed calendar day", () => {
    const dt = parseCalendarDay("2026-06-15");
    expect(dt).not.toBeNull();
    expect(dt!.year).toBe(2026);
    expect(dt!.month).toBe(6);
    expect(dt!.day).toBe(15);
  });

  it("parseCalendarDay returns null for unparseable input", () => {
    expect(parseCalendarDay("not a date")).toBeNull();
    expect(parseCalendarDay("")).toBeNull();
    expect(parseCalendarDay("2026-13-99")).toBeNull();
  });

  it("formatCalendarDayWire renders any DateTime at midnight in its own zone", () => {
    const dt = parseCalendarDay("2026-06-15 18:30:45");
    expect(formatCalendarDayWire(dt!)).toBe("2026-06-15 00:00:00");
  });

  it("preserves an offset-bearing input's calendar day (renders in the embedded zone, not UTC)", () => {
    // 2026-06-15T22:00:00-08:00 is 2026-06-16T06:00:00Z. formatCalendarDayWire must
    // format in the input's own zone so the typed June 15 survives.
    const dt = parseCalendarDay("2026-06-15T22:00:00-08:00");
    expect(formatCalendarDayWire(dt!)).toBe("2026-06-15 00:00:00");
  });

  it("day arithmetic is DST-free: start + (N−1) days lands on the right calendar day", () => {
    // A 3-day span starting 2026-05-27 → day 1 = 05-27, day 3 = 05-29 (mirrors
    // the add-menu-to-planner wire capture).
    const start = parseCalendarDay("2026-05-27");
    expect(start).not.toBeNull();
    expect(formatCalendarDayWire(start!.plus({ days: 0 }))).toBe("2026-05-27 00:00:00");
    expect(formatCalendarDayWire(start!.plus({ days: 2 }))).toBe("2026-05-29 00:00:00");
  });

  it("parseCalendarDayWire equals formatCalendarDayWire(parseCalendarDay(...)) — composition holds", () => {
    for (const input of [
      "2026-06-15",
      "2026-06-15 18:30:45",
      "2026-06-15T22:00:00-08:00",
      "2026-06-15T02:00:00+09:00",
    ]) {
      const viaDay = parseCalendarDay(input);
      expect(parseCalendarDayWire(input)).toBe(viaDay === null ? null : formatCalendarDayWire(viaDay));
    }
  });
});

describe("formatTimestampWire", () => {
  it("formats a Date as yyyy-MM-dd HH:mm:ss with no timezone marker", () => {
    const d = new Date("2026-05-08T12:34:56Z");
    const out = formatTimestampWire(d);
    // Format is local-time; assert shape, not a specific value (host TZ varies).
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe("todayWire", () => {
  it("returns today's date at midnight in Paprika wire format", () => {
    const out = todayWire();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2} 00:00:00$/);
  });
});

describe("normalizeWire", () => {
  it("passes through already-Paprika format", () => {
    expect(normalizeWire("2026-12-31 00:00:00")).toBe("2026-12-31 00:00:00");
  });

  it("normalizes bare yyyy-MM-dd to midnight", () => {
    expect(normalizeWire("2026-12-31")).toBe("2026-12-31 00:00:00");
  });

  it("normalizes yyyy/MM/dd to midnight", () => {
    expect(normalizeWire("2026/12/31")).toBe("2026-12-31 00:00:00");
  });

  it("preserves the input's date when ISO 8601 includes a Z timezone marker", () => {
    // Regression test for Codex P2: previously fromISO returned the parsed
    // value in the host's local zone, then startOf("day") truncated to local
    // midnight. On a non-UTC host, "2026-12-31T00:00:00Z" would shift to
    // 2026-12-30 before truncation. With { setZone: true }, startOf operates
    // in the input's intended zone (UTC here) and the date is preserved.
    expect(normalizeWire("2026-12-31T00:00:00Z")).toBe("2026-12-31 00:00:00");
  });

  it("preserves the input's date when ISO 8601 includes an explicit offset", () => {
    // "2026-12-31T00:00:00-08:00" represents a Pacific-zone moment that the
    // user clearly meant as "the start of Dec 31 in their local zone."
    // Without setZone, Luxon would convert to local-of-host before truncation,
    // potentially shifting the date. With it, we preserve the user's intent.
    expect(normalizeWire("2026-12-31T00:00:00-08:00")).toBe("2026-12-31 00:00:00");
  });

  it("returns null on unparseable input", () => {
    expect(normalizeWire("not a date")).toBeNull();
    expect(normalizeWire("")).toBeNull();
    expect(normalizeWire("13/45/2026")).toBeNull();
  });
});
