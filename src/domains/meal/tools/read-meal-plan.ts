import { DateTime } from "luxon";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { toolResult } from "../../../shared/tools.js";
import { mealStartGuard } from "./guards.js";
import { renderMealsGroupedByDate } from "./helpers.js";

export const readMealPlanInputSchema = z
  .object({
    days: z
      .number()
      .int()
      .positive()
      .max(31)
      .optional()
      .describe("How many days of the plan to show, counting today (default 7, max 31)."),
  })
  .strict();

/**
 * `read_meal_plan` — show upcoming scheduled meals. Meal-type names for rendering
 * come from `ctx.deps["meal-type"]`.
 */
export const readMealPlanTool = defineTool(
  {
    name: "read_meal_plan",
    title: "Show upcoming planned meals",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Read the upcoming meal plan: meals scheduled from today forward, grouped by day in ascending date " +
      'order (today first). Defaults to the next 7 days; pass `days` to widen the window. For past meals or recall ("when did we last have X"), use search_meal_history.',
    inputSchema: readMealPlanInputSchema,
  },
  [mealStartGuard],
  (ctx: DomainCtx<MealState, "recipe" | "meal-type">) => {
    return async (args) => {
      // Default applied here, not via Zod `.default()`: the SDK parses input in
      // production, but the unit-test harness invokes the handler with raw args,
      // so a schema default wouldn't fire there.
      const days = args.days ?? 7;
      // Window: `days` calendar days starting today, inclusive — days=7 is today
      // through today+6. Meals are day-granular and store at midnight, so
      // start-of-day includes today's.
      const since = DateTime.utc().startOf("day");
      const until = since.plus({ days: days - 1 }).endOf("day");

      // High limit: a week or two of meals is small, and the plan view wants the
      // whole window (no pagination). getInDateRange caps internally regardless.
      const { meals } = ctx.state.store.getInDateRange({ since, until, offset: 0, limit: 500 });

      if (meals.length === 0) {
        return toolResult(
          `No meals planned between ${since.toFormat("yyyy-MM-dd")} and ${until.toFormat("yyyy-MM-dd")}.`,
        );
      }

      // getInDateRange sorts DESC (newest-first); the plan reads forward, so
      // re-sort ASCENDING. Wire dates ("yyyy-MM-dd HH:mm:ss") sort lexically in
      // chronological order; ties break by meal type (Breakfast → Lunch → …).
      const ascending = [...meals].sort((a, b) => {
        if (a.date !== b.date) return a.date < b.date ? -1 : 1;
        return a.type - b.type;
      });

      const count = ascending.length;
      const header =
        `**Meal plan: ${since.toFormat("yyyy-MM-dd")} – ${until.toFormat("yyyy-MM-dd")}** ` +
        `(${count.toString()} meal${count === 1 ? "" : "s"})`;
      return toolResult(`${header}\n${renderMealsGroupedByDate(ascending, ctx.deps["meal-type"])}`);
    };
  },
);
