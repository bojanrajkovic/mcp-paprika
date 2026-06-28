import { z } from "zod";

import { MealTypeUidSchema } from "../meal-type/ids.js";
import { RecipeUidSchema } from "../recipe/ids.js";
import { MealUidSchema } from "./ids.js";

/**
 * The meal domain's structured-output schemas — the leaf the widget type surface re-exports
 * (`src/features/widgets/shared/server-types.ts`). It imports nothing but zod and the branded-id
 * leaves, so the meal-week-planner's typecheck graph can pull these inferred types without dragging
 * the kernel/entity layer into the browser `svelte-check` (which fails under the DOM lib). The
 * stateful formatters that build these rows live in `tools/helpers.ts`, which re-exports this leaf
 * for its co-located tool consumers.
 */

/**
 * The structured-output row for one meal, shared by `read_meal_plan` and
 * `search_meal_history`. The `uid` is the gap-closer: without this row the model
 * cannot drive `reschedule_meal` / `delete_meal` / `update_meal` after a read. The
 * fields are exactly what those follow-ups consume — `recipeUid` / `typeUid` /
 * `typeName` / `scale` let the model build an `update_meal` partial without
 * re-querying; `date` is the calendar day `reschedule_meal` takes. The vestigial
 * `type` integer, the internal `orderFlag`, and the non-actionable `isIngredient` /
 * `deleted` are deliberately omitted.
 */
export const mealRowSchema = z.object({
  uid: MealUidSchema,
  date: z.string().describe("Calendar day, yyyy-MM-dd."),
  name: z.string(),
  recipeUid: RecipeUidSchema.nullable().describe("Linked recipe UID, or null for a freeform meal."),
  typeUid: MealTypeUidSchema.nullable().describe("Meal-type UID, or null for a legacy meal predating the catalog."),
  typeName: z.string().nullable().describe("Resolved meal-type name, or null when the type is dangling/unknown."),
  scale: z.string().nullable(),
});

export type MealRow = z.infer<typeof mealRowSchema>;

/**
 * The `{ items }` structured-output wrapper shared by the meal-list reads:
 * `search_meal_history` returns it (`.extend()`ed with its pagination cursor).
 * `structuredContent` is a record, never a bare array, so the rows ride under `items` —
 * the tree-wide list convention. (`read_meal_plan` once shared this too, but its widget
 * surface needs the richer week payload below.)
 */
export const mealListOutputSchema = z.object({ items: z.array(mealRowSchema) });

/** One entry in the meal-week payload's meal-type registry. */
export const mealTypeRefSchema = z.object({ uid: MealTypeUidSchema, name: z.string() });

export type MealTypeRef = z.infer<typeof mealTypeRefSchema>;

/**
 * `read_meal_plan`'s structured-output payload — a self-contained week the
 * meal-week-planner widget renders without a second `list_meal_types` call.
 * `weekStart` (Monday of the returned window) anchors the widget's prev/next navigation;
 * `meals` are the window's rows (shared {@link mealRowSchema}, with its denormalized
 * `typeName`); `mealTypes` is the catalog ordered by `orderFlag`, so an EMPTY day slot
 * still shows its meal-type label. Diverges from {@link mealListOutputSchema}: this read
 * is a week, not a flat list.
 */
export const mealWeekOutputSchema = z.object({
  weekStart: z
    .string()
    .describe("YYYY-MM-DD; Monday of the returned window — the meal-week-planner widget's navigation anchor."),
  meals: z.array(mealRowSchema),
  mealTypes: z
    .array(mealTypeRefSchema)
    .describe("Meal-type registry, ordered by orderFlag, for the widget's day-slot labels (empty slots included)."),
});

export type MealWeekStructured = z.infer<typeof mealWeekOutputSchema>;
