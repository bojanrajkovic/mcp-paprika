import { isDeepStrictEqual } from "node:util";

import type { z } from "zod";

/**
 * Build a content-equality predicate for an entity from its Zod *stored* schema —
 * the `equals` (change detection) that `syncReplaceAllEntity` consults to decide
 * whether a canonical row actually changed.
 *
 * The compared key set is derived from `schema.shape`, not hand-listed: that is the
 * whole point (#240). The per-entity `*Equal` functions this replaces enumerated
 * fields by hand, so a field added to the schema but forgotten in the comparator
 * silently broke change detection (a "changed" row that compares equal never
 * re-syncs). Sourcing the keys from the schema makes that drift impossible — a new
 * field is compared the moment it joins the schema.
 *
 * `deleted` is excluded: Paprika never returns `deleted:true` on a read, so both
 * sides always carry the `.default(false)` value and the term is inert as a change
 * signal — comparing it would re-introduce the removed `mealsEqual` "wart". The
 * exclusion is a no-op for schemas without the field (e.g. `Category`), so every
 * call site is just `makeSchemaEquals(SomeStoredSchema)` with no per-entity config.
 *
 * Leaf comparison is `isDeepStrictEqual`: identical to `===` for the all-primitive
 * fields these entities carry today (strings, ints, booleans, null — no NaN/-0), so
 * behavior is unchanged, while a future nested field would be compared by value
 * rather than silently by reference.
 */
export function makeSchemaEquals<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
): (a: z.infer<z.ZodObject<Shape>>, b: z.infer<z.ZodObject<Shape>>) => boolean {
  const keys = Object.keys(schema.shape).filter((key) => key !== "deleted") as ReadonlyArray<
    keyof z.infer<z.ZodObject<Shape>>
  >;
  return (a, b) => keys.every((key) => isDeepStrictEqual(a[key], b[key]));
}
