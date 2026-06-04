import { z } from "zod";

import type { MealType } from "./types.js";

import { MealTypeUidSchema } from "../../ids.js";

/**
 * Union for selecting a meal type by name, UID, or built-in index. Three
 * strict-object variants; consumers dispatch via property-presence checks
 * (`"uid" in spec`, `"name" in spec`, else `builtin`). This shape matches
 * the original inline schema in meal-history.ts byte-for-byte after
 * hoisting — meal-history.ts's resolver is unchanged by the swap.
 *
 *   {name: string}    → display name; resolution is case-insensitive; whitespace trimmed via transform.
 *   {uid: MealTypeUid}→ branded MealType UID, direct lookup.
 *   {builtin: int}    → integer 0=Breakfast 1=Lunch 2=Dinner 3=Snacks.
 *
 * Exported for use by both meal-history.ts (read side) and meal-writes.ts
 * (write side). Write tools produce richer error messages naming the known
 * meal types and the {uid}/{builtin} discriminators when resolution fails.
 */
export const mealTypeSpecSchema = z.union([
  z
    .object({
      name: z
        .string()
        .min(1)
        .transform((s) => s.trim()),
    })
    .strict(),
  z.object({ uid: MealTypeUidSchema }).strict(),
  z.object({ builtin: z.number().int().min(0).max(3) }).strict(),
]);

/**
 * Structured result of resolving a `mealTypeSpecSchema` union variant against
 * `mealTypeStore`. The resolver never formats user-facing text — it returns the
 * resolved `MealType` on a hit, or one of three error reasons callers map to
 * their own message style (terse for `update_meal` / `reschedule_meal`,
 * per-index-prefixed for `plan_meals`). `unknown_name` carries
 * `knownNames` so callers can list the available types as a remediation hint.
 */
export type MealTypeResolveResult =
  | { readonly ok: true; readonly resolved: MealType }
  | { readonly ok: false; readonly reason: "unknown_uid"; readonly uid: string }
  | {
      readonly ok: false;
      readonly reason: "unknown_name";
      readonly name: string;
      readonly knownNames: ReadonlyArray<string>;
    }
  | { readonly ok: false; readonly reason: "unknown_builtin"; readonly index: number };

/**
 * Render a failed `resolveMealTypeSpec` result as a single user-facing error
 * string. The one place that owns the three error-reason → message mapping;
 * shared by update_meal, reschedule_meal, log_cooked_meal, and search_meal_history.
 * (plan_meals formats its own per-index-prefixed variant in its batch loop.)
 */
export function formatMealTypeResolveError(result: Extract<MealTypeResolveResult, { ok: false }>): string {
  if (result.reason === "unknown_uid") {
    return `Unknown meal type UID "${result.uid}".`;
  }
  if (result.reason === "unknown_name") {
    return (
      `Unknown meal type "${result.name}". Known types: ${result.knownNames.join(", ")}. ` +
      `Use the {uid} or {builtin} discriminator to reference a custom meal type.`
    );
  }
  return (
    `No built-in meal type found with index ${result.index.toString()} ` +
    `(expected 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks).`
  );
}
