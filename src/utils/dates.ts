import { DateTime } from "luxon";

/**
 * Date/time helpers for the Paprika Cloud Sync wire format.
 *
 * Paprika encodes every date as a plain `"yyyy-MM-dd HH:mm:ss"` string — no
 * timezone, no `T` separator, no fractional seconds. This module is the single
 * home for parsing user input into Luxon `DateTime`s and rendering wire strings.
 *
 * ## Two semantic axes
 *
 * Reading any helper's name answers two questions:
 *
 * - **Return type** — `parse*` returns a `DateTime | null` (for comparison or
 *   arithmetic); `format*` / `today*` / `normalize*` return a wire `string`.
 * - **Semantics** — `*Instant*` models a UTC moment in time; `*CalendarDay*`
 *   models a day on the user's calendar.
 *
 * The distinction matters because the two collapse the timezone differently:
 *
 * - **UTC-instant** (`parseInstant`): the input is a moment, normalized to UTC.
 *   Used by `list_meal_history` for since/until window comparisons, where two
 *   timestamps must order correctly regardless of the zone they were typed in.
 * - **Calendar-day** (`parseCalendarDay`, `formatCalendarDayWire`,
 *   `parseCalendarDayWire`): the input is a day the user picked, and that day
 *   must survive even when the time-of-day would cross the UTC date boundary.
 *   A user in US-Pacific who types "June 15, 10 PM" means June 15 — converting
 *   to UTC first would store June 16. These helpers honor an embedded offset and
 *   render in the input's own zone so the typed day is preserved. Used when
 *   storing a meal's `date`, which Paprika stores at midnight (day-granular).
 *
 * `formatTimestampWire` and `todayWire` cover the pantry/grocery wire boundary,
 * which records a full local timestamp rather than a calendar day.
 *
 * Pure helpers — no I/O, no internal dependencies (leaf module).
 */

const WIRE_FORMAT = "yyyy-MM-dd HH:mm:ss";

// Explicit (zone-less) formats tried before the ISO 8601 fallback. They carry
// no zone information, so both parsers treat them as UTC by convention; the
// parsers diverge only on how they interpret an ISO input's embedded offset.
const EXPLICIT_FORMATS = [WIRE_FORMAT, "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"] as const;

/**
 * Try each zone-less explicit format in priority order, parsing as UTC. The
 * shared prefix of {@link parseInstant} and {@link parseCalendarDay} — they
 * differ only in the ISO 8601 fallback's zone policy. Returns `null` when none
 * match (the caller then attempts ISO).
 */
function parseExplicit(input: string): DateTime | null {
  for (const fmt of EXPLICIT_FORMATS) {
    const dt = DateTime.fromFormat(input, fmt, { zone: "utc" });
    if (dt.isValid) return dt;
  }
  return null;
}

/**
 * Parse a user-supplied date or datetime string into a UTC Luxon `DateTime`.
 * Tries the explicit formats first (parsed as UTC), then ISO 8601 as a fallback
 * (also coerced to UTC, ignoring any embedded offset). Returns `null` when no
 * format matches.
 *
 * UTC-instant semantics — use for since/until window comparisons. For the
 * calendar-day-preserving variant used when storing a meal's `date`, see
 * {@link parseCalendarDay} / {@link parseCalendarDayWire}.
 */
export function parseInstant(input: string): DateTime | null {
  const explicit = parseExplicit(input);
  if (explicit) return explicit;
  // ISO 8601 fallback, coerced to UTC — any embedded offset is normalized away.
  const iso = DateTime.fromISO(input, { zone: "utc" });
  return iso.isValid ? iso : null;
}

/**
 * Parse a user-supplied date or datetime into the `DateTime` representing the
 * user's intended local calendar day. The day-extracting core that
 * {@link parseCalendarDayWire} (wire string) and meal-planner date arithmetic
 * build on.
 *
 * For inputs that carry a UTC offset ("2026-06-15T22:00:00-08:00") this honors
 * that offset's calendar day rather than converting to UTC first — so the user
 * who typed June 15 sees June 15, regardless of whether 22:00 in their zone
 * crosses the UTC date boundary. For bare datetimes and date-only inputs the day
 * part is taken as-is (parsed as UTC by convention). The returned `DateTime`
 * keeps its parsed zone; render it with {@link formatCalendarDayWire}, which
 * formats in that zone so the calendar day is preserved.
 *
 * Returns `null` when the input doesn't parse as any supported format.
 */
export function parseCalendarDay(input: string): DateTime | null {
  // Same explicit-format priority as parseInstant (UTC by convention)...
  const explicit = parseExplicit(input);
  if (explicit) return explicit;
  // ...but the ISO 8601 fallback uses `setZone: true` to honor the input's
  // embedded offset (e.g. `-08:00`) so the rendered date reflects that zone
  // rather than a UTC-shifted day. For inputs without an offset (bare
  // datetimes) the earlier `yyyy-MM-dd'T'HH:mm:ss` format match catches them.
  const iso = DateTime.fromISO(input, { setZone: true });
  return iso.isValid ? iso : null;
}

/**
 * Render a `DateTime` as a Paprika wire string at midnight
 * ("yyyy-MM-dd 00:00:00"). Formats in the `DateTime`'s own zone (NOT UTC) so the
 * calendar day from {@link parseCalendarDay} is preserved — the meal planner is
 * day-granular and the wire string functions as a calendar-day label rather than
 * a UTC instant (Paprika.app stores meals at midnight per the wire captures,
 * `docs/wire-captures/meals.har.json`). Use this for day arithmetic too:
 * `formatCalendarDayWire(startDay.plus({ days: offset }))` is DST-free because
 * the time-of-day is discarded.
 */
export function formatCalendarDayWire(dt: DateTime): string {
  return `${dt.toFormat("yyyy-MM-dd")} 00:00:00`;
}

/**
 * Parse a user-supplied date or datetime and return the user's intended local
 * calendar day as a Paprika wire string at midnight ("yyyy-MM-dd 00:00:00").
 * Thin composition of {@link parseCalendarDay} + {@link formatCalendarDayWire} —
 * the single source of truth for "user date input → stored meal `date`". Used by
 * `plan_meals` / `update_meal`; `list_meal_history` instead uses
 * {@link parseInstant} for its UTC-anchored since/until comparisons.
 *
 * Returns `null` when the input doesn't parse as any supported format.
 */
export function parseCalendarDayWire(input: string): string | null {
  const dt = parseCalendarDay(input);
  return dt === null ? null : formatCalendarDayWire(dt);
}

/**
 * Format a JavaScript `Date` as a Paprika wire string, preserving its full
 * local timestamp (not snapped to midnight). Used at the wire boundary when
 * recording a precise moment — e.g. a recipe's `created` field. Not for display.
 */
export function formatTimestampWire(d: Date): string {
  return DateTime.fromJSDate(d).toFormat(WIRE_FORMAT);
}

/**
 * Today's date at midnight (local time) in Paprika wire format — today's local
 * calendar day rendered as a wire string ({@link formatCalendarDayWire}).
 *
 * Mirrors what the macOS Paprika app sends as `purchase_date` when a user adds a
 * new pantry item: today's date, time normalized to 00:00:00.
 */
export function todayWire(): string {
  return formatCalendarDayWire(DateTime.now());
}

/**
 * Normalize a user-supplied date string into Paprika wire format, leniently.
 *
 * Accepts:
 * - already-Paprika ("yyyy-MM-dd HH:mm:ss") — returned verbatim, time preserved
 * - ISO 8601 ("2026-12-31T00:00:00Z" or "2026-12-31T08:30:00") — snapped to
 *   midnight in the input's own zone
 * - date-only ("yyyy-MM-dd" or "yyyy/MM/dd") — at midnight
 *
 * Returns `null` on unparseable input rather than throwing — callers at the MCP
 * boundary should propagate the rejection. Unlike {@link parseCalendarDayWire}
 * (which always snaps to midnight), this preserves the time-of-day when the
 * input is already wire-format, so a round-tripped pantry date is unchanged.
 * Used for pantry `expiration_date` / `purchase_date`.
 */
export function normalizeWire(input: string): string | null {
  // Already in Paprika format (most common when round-tripping store values).
  // Returned verbatim — this is the one branch that keeps the time-of-day,
  // which is why normalizeWire is distinct from parseCalendarDayWire.
  const wire = DateTime.fromFormat(input, WIRE_FORMAT);
  if (wire.isValid) return wire.toFormat(WIRE_FORMAT);

  // ISO 8601 (what `new Date().toISOString()` produces; what LLMs often emit).
  // setZone: true preserves any explicit offset/`Z` in the input so the calendar
  // day reflects the input's intended zone rather than the host's local zone.
  // Without it, `"2026-12-31T00:00:00Z"` on a Pacific host would render as
  // 2026-12-30. formatCalendarDayWire then snaps to midnight in that zone.
  const iso = DateTime.fromISO(input, { setZone: true });
  if (iso.isValid) return formatCalendarDayWire(iso);

  // Bare date-only forms — snap to midnight via the same calendar-day renderer.
  for (const fmt of ["yyyy-MM-dd", "yyyy/MM/dd"]) {
    const dt = DateTime.fromFormat(input, fmt);
    if (dt.isValid) return formatCalendarDayWire(dt);
  }

  return null;
}
