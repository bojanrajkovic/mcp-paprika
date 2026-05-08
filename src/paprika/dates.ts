// pattern: Pure helpers — Paprika sync API date format.
// Paprika encodes pantry/grocery dates as plain "yyyy-MM-dd HH:mm:ss" strings
// (no timezone, no T separator, no fractional seconds). Captured 2026-05-08
// from the macOS Paprika.app v3.8.4 build:41 talking to /api/v2/sync/pantry/.

import { DateTime } from "luxon";

const PAPRIKA_DATE_FORMAT = "yyyy-MM-dd HH:mm:ss";

/**
 * Format a JavaScript Date as a Paprika wire date string.
 * Used at the wire boundary; not for display.
 */
export function formatPaprikaDate(d: Date): string {
  return DateTime.fromJSDate(d).toFormat(PAPRIKA_DATE_FORMAT);
}

/**
 * Today's date at midnight (local time) in Paprika wire format.
 *
 * Mirrors what the macOS Paprika app sends as `purchase_date` when a user
 * adds a new pantry item: today's date, time normalized to 00:00:00.
 */
export function paprikaDateToday(): string {
  return DateTime.now().startOf("day").toFormat(PAPRIKA_DATE_FORMAT);
}

/**
 * Normalize a user-supplied date string into Paprika wire format.
 *
 * Accepts:
 * - already-Paprika ("yyyy-MM-dd HH:mm:ss")
 * - ISO 8601 ("2026-12-31T00:00:00Z" or "2026-12-31T08:30:00")
 * - date-only ("yyyy-MM-dd" or "yyyy/MM/dd")
 *
 * Returns the input snapped to midnight in the parsed timezone, formatted
 * as `yyyy-MM-dd HH:mm:ss`. Returns null on unparseable input rather than
 * throwing — callers at the MCP boundary should propagate the rejection.
 */
export function normalizePaprikaDate(input: string): string | null {
  // Already in Paprika format (most common when round-tripping store values).
  let dt = DateTime.fromFormat(input, PAPRIKA_DATE_FORMAT);
  if (dt.isValid) return dt.toFormat(PAPRIKA_DATE_FORMAT);

  // ISO 8601 (what `new Date().toISOString()` produces; what LLMs often emit).
  // setZone: true preserves any explicit offset/`Z` in the input so that
  // `startOf("day")` operates in the input's intended zone rather than the
  // host's local zone. Without this, `"2026-12-31T00:00:00Z"` on a Pacific
  // host would shift to `2026-12-30` before truncation.
  dt = DateTime.fromISO(input, { setZone: true });
  if (dt.isValid) return dt.startOf("day").toFormat(PAPRIKA_DATE_FORMAT);

  // Bare yyyy-MM-dd.
  dt = DateTime.fromFormat(input, "yyyy-MM-dd");
  if (dt.isValid) return dt.toFormat(PAPRIKA_DATE_FORMAT);

  // Bare yyyy/MM/dd.
  dt = DateTime.fromFormat(input, "yyyy/MM/dd");
  if (dt.isValid) return dt.toFormat(PAPRIKA_DATE_FORMAT);

  return null;
}
