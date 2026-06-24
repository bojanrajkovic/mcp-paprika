import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealTypeState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { sortCatalog } from "../../../shared/catalog.js";
import { structuredResult } from "../../../shared/tools.js";
import { MealTypeUidSchema } from "../ids.js";
import { mealTypeStartGuard } from "./guards.js";

// Structured-output payload (ADR-0019, R1): one row per meal type, carrying the `uid`
// (the `type: { uid }` spec / update_meal_type / delete_meal_type consume) and
// `originalType` — the built-in index usable as `type: { builtin: N }`, or null for a
// custom type. The calendar-export schedule stays text-only (display, not actionable).
export const listMealTypesOutputSchema = z.object({
  items: z.array(
    z.object({
      uid: MealTypeUidSchema,
      name: z.string(),
      originalType: z
        .number()
        .int()
        .nullable()
        .describe("Built-in index (0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks), or null for a custom type."),
    }),
  ),
});

/**
 * Build the {@link listMealTypesOutputSchema} rows from the meal-type catalog — sorted
 * by order then name, one `{uid, name, originalType}` per type. Shared by
 * `list_meal_types` and `update_meal_type` so the two echo the identical shape.
 */
export function buildMealTypeRows(state: MealTypeState): z.infer<typeof listMealTypesOutputSchema>["items"] {
  return sortCatalog(state.store.getAll()).map((mt) => ({
    uid: mt.uid,
    name: mt.name,
    originalType: mt.originalType,
  }));
}

/**
 * `list_meal_types` — list the meal-type catalog (sorted by order then name, one
 * bullet per entry, no input). Meal-type is a Reference-class entity: list tool +
 * managed lifecycle (auto-create via `ensureMealType`, `update_meal_type`,
 * `delete_meal_type`), no resource. Mirrors `list_aisles`.
 */
export const listMealTypesTool = defineTool(
  {
    name: "list_meal_types",
    title: "List meal types",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "List all meal types — the built-in Breakfast/Lunch/Dinner/Snacks plus any custom " +
      "types — sorted by order then name. Each entry shows whether it is built-in or custom, " +
      "its calendar-export schedule (all-day or a clock time), and its UID. Reference a type " +
      "by name, or pass its UID to plan_meals / update_meal via the `type: { uid }` spec. " +
      "Planning a meal with a new type name creates it; update_meal_type and delete_meal_type manage the catalog.",
    inputSchema: {},
    outputSchema: listMealTypesOutputSchema,
  },
  [mealTypeStartGuard],
  (ctx: DomainCtx<MealTypeState, never>) => {
    return async () => structuredResult({ items: buildMealTypeRows(ctx.state) });
  },
);
