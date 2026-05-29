import { DateTime } from "luxon";

/**
 * Parse a user-supplied date or datetime string into a UTC Luxon DateTime.
 * Tries explicit formats first (Paprika wire format, RFC-like, date-only),
 * then ISO 8601 as a fallback. Returns null when no format matches.
 *
 * Mirrors the inline parseInputDate currently in src/tools/meal-history.ts;
 * intentional duplication will be resolved by a follow-up issue.
 */
export function parseInputDate(input: string): DateTime | null {
  for (const fmt of ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"]) {
    const dt = DateTime.fromFormat(input, fmt, { zone: "utc" });
    if (dt.isValid) return dt;
  }
  const iso = DateTime.fromISO(input, { zone: "utc" });
  if (iso.isValid) return iso;
  return null;
}

/**
 * Render a DateTime as Paprika's wire date format ("yyyy-MM-dd HH:mm:ss")
 * in UTC. Use this for any string that crosses the network as a meal date.
 */
export function toWireDateFormat(dt: DateTime): string {
  return dt.toUTC().toFormat("yyyy-MM-dd HH:mm:ss");
}
