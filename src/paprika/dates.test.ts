import { describe, expect, it } from "vitest";
import { formatPaprikaDate, normalizePaprikaDate, paprikaDateToday } from "./dates.js";

describe("paprika date helpers", () => {
  describe("formatPaprikaDate", () => {
    it("formats a Date as yyyy-MM-dd HH:mm:ss with no timezone marker", () => {
      const d = new Date("2026-05-08T12:34:56Z");
      const out = formatPaprikaDate(d);
      // Format is local-time; assert shape, not a specific value (host TZ varies).
      expect(out).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });
  });

  describe("paprikaDateToday", () => {
    it("returns today's date at midnight in Paprika wire format", () => {
      const out = paprikaDateToday();
      expect(out).toMatch(/^\d{4}-\d{2}-\d{2} 00:00:00$/);
    });
  });

  describe("normalizePaprikaDate", () => {
    it("passes through already-Paprika format", () => {
      expect(normalizePaprikaDate("2026-12-31 00:00:00")).toBe("2026-12-31 00:00:00");
    });

    it("normalizes bare yyyy-MM-dd to midnight", () => {
      expect(normalizePaprikaDate("2026-12-31")).toBe("2026-12-31 00:00:00");
    });

    it("normalizes yyyy/MM/dd to midnight", () => {
      expect(normalizePaprikaDate("2026/12/31")).toBe("2026-12-31 00:00:00");
    });

    it("preserves the input's date when ISO 8601 includes a Z timezone marker", () => {
      // Regression test for Codex P2: previously fromISO returned the parsed
      // value in the host's local zone, then startOf("day") truncated to local
      // midnight. On a non-UTC host, "2026-12-31T00:00:00Z" would shift to
      // 2026-12-30 before truncation. With { setZone: true }, startOf operates
      // in the input's intended zone (UTC here) and the date is preserved.
      expect(normalizePaprikaDate("2026-12-31T00:00:00Z")).toBe("2026-12-31 00:00:00");
    });

    it("preserves the input's date when ISO 8601 includes an explicit offset", () => {
      // "2026-12-31T00:00:00-08:00" represents a Pacific-zone moment that the
      // user clearly meant as "the start of Dec 31 in their local zone."
      // Without setZone, Luxon would convert to local-of-host before truncation,
      // potentially shifting the date. With it, we preserve the user's intent.
      expect(normalizePaprikaDate("2026-12-31T00:00:00-08:00")).toBe("2026-12-31 00:00:00");
    });

    it("returns null on unparseable input", () => {
      expect(normalizePaprikaDate("not a date")).toBeNull();
      expect(normalizePaprikaDate("")).toBeNull();
      expect(normalizePaprikaDate("13/45/2026")).toBeNull();
    });
  });
});
