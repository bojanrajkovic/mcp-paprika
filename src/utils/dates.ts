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

/**
 * Parse a user-supplied date or datetime and return the user's intended local
 * calendar day as a Paprika meal-wire string at midnight ("yyyy-MM-dd 00:00:00").
 *
 * For inputs that carry a UTC offset ("2026-06-15T22:00:00-08:00") this honors
 * that offset's calendar day rather than converting to UTC first — so the user
 * who typed June 15 sees June 15 stored, regardless of whether 22:00 in their
 * zone crosses the UTC date boundary. For bare datetimes and date-only inputs
 * the behavior is unchanged (the day part is taken as-is).
 *
 * Use this for meal `date` fields specifically. The meal planner is day-
 * granular, and the wire string functions as a calendar-day label rather than
 * a UTC instant — Paprika.app stores meals at midnight per the wire captures
 * (`docs/wire-captures/meals.har.json`) and `list_meal_history` groups by
 * `date.slice(0, 10)`.
 *
 * Returns null when the input doesn't parse as any supported format.
 */
export function parseInputMealDate(input: string): string | null {
  // Same explicit-format priority as parseInputDate; these formats carry no
  // zone information so we treat them as UTC by convention.
  for (const fmt of ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"]) {
    const dt = DateTime.fromFormat(input, fmt, { zone: "utc" });
    if (dt.isValid) return `${dt.toFormat("yyyy-MM-dd")} 00:00:00`;
  }
  // ISO 8601 fallback. `setZone: true` honors the input's embedded offset
  // (e.g. `-08:00`) so the date portion below reflects that zone rather than
  // a UTC-shifted day. For inputs without an offset (bare datetimes) the
  // earlier `yyyy-MM-dd'T'HH:mm:ss` format match catches them first.
  const iso = DateTime.fromISO(input, { setZone: true });
  if (iso.isValid) return `${iso.toFormat("yyyy-MM-dd")} 00:00:00`;
  return null;
}
