import { DateTime } from "luxon";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { errorResult, toolResult } from "../../../shared/tools.js";
import { mealStartGuard } from "./guards.js";
import {
  mealToRow,
  mealTypeRegistry,
  mealWeekOutputSchema,
  renderMealsGroupedByDate,
  resolveMealTypeName,
} from "./helpers.js";

export const readMealPlanInputSchema = z
  .object({
    days: z
      .number()
      .int()
      .positive()
      .max(31)
      .optional()
      .describe("How many days of the plan to show, counting from the window start (default 7, max 31)."),
    startDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.")
      .optional()
      .describe(
        "Anchor the window to this day (YYYY-MM-DD) instead of today, reading any past or future week. " +
          "The meal-week-planner widget passes the Monday of each week it navigates to; omit it for the upcoming plan.",
      ),
  })
  .strict();

// Structured-output payload: the `mealWeekOutputSchema` week —
// `weekStart` (Monday of the window, the widget's nav anchor), `meals` (rows carrying
// the `uid` the rendered text omits, for `reschedule_meal` / `delete_meal` /
// `update_meal`), and the ordered `mealTypes` registry for the widget's day slots.
// An empty window still emits the registry + weekStart so the widget renders empty
// slots — `meals: []` is a valid empty success.

/**
 * `read_meal_plan` — show scheduled meals. Defaults to today forward; an explicit
 * `startDate` anchors the window to any week (the meal-week-planner widget's prev/next
 * navigation). Meal-type names come from `ctx.deps["meal-type"]`.
 */
export const readMealPlanTool = defineTool(
  {
    name: "read_meal_plan",
    title: "Show planned meals for a week",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Read the meal plan: meals grouped by day in ascending date order. Defaults to the next 7 days from " +
      "today; pass `days` to widen the window (max 31) and `startDate` (YYYY-MM-DD) to anchor it to a specific " +
      'week, past or future. For recall ("when did we last have X"), use search_meal_history.',
    inputSchema: readMealPlanInputSchema,
    outputSchema: mealWeekOutputSchema,
    // Hosts with the apps surface render this result as the meal-week-planner widget; others
    // show the text/structured result unchanged.
    ui: { resourceUri: "ui://widget/meal-week-planner" },
  },
  [mealStartGuard],
  (ctx: DomainCtx<MealState, "recipe" | "meal-type">) => {
    return async (args) => {
      // Default applied here, not via Zod `.default()`: the SDK parses input in
      // production, but the unit-test harness invokes the handler with raw args,
      // so a schema default wouldn't fire there.
      const days = args.days ?? 7;
      // Window start: an explicit `startDate` anchors to any day (no today-floor, so
      // the widget can read past weeks); otherwise today. The regex pins the format;
      // luxon still rejects a calendar-invalid date like 2026-13-40, which the regex
      // lets through.
      let since: DateTime;
      if (args.startDate !== undefined) {
        const parsed = DateTime.fromISO(args.startDate, { zone: "utc" }).startOf("day");
        if (!parsed.isValid) {
          return errorResult(`startDate "${args.startDate}" is not a valid calendar date (expected YYYY-MM-DD).`);
        }
        since = parsed;
      } else {
        since = DateTime.utc().startOf("day");
      }
      // `days` calendar days from the window start, inclusive — days=7 is start
      // through start+6. Meals are day-granular and store at midnight, so
      // start-of-day includes the start day's meals.
      const until = since.plus({ days: days - 1 }).endOf("day");
      // Monday of the window (luxon weeks are ISO/Monday-start) — the widget's nav
      // anchor, independent of where `since` falls in its week.
      const weekStart = since.startOf("week").toFormat("yyyy-MM-dd");
      // The ordered meal-type catalog, surfaced even on an empty week so the widget can
      // label its day slots.
      const mealTypes = mealTypeRegistry(ctx.deps["meal-type"]);

      // High limit: a week or two of meals is small, and the plan view wants the
      // whole window (no pagination). getInDateRange caps internally regardless.
      const { meals } = ctx.state.store.getInDateRange({ since, until, offset: 0, limit: 500 });

      if (meals.length === 0) {
        return toolResult(
          `No meals planned between ${since.toFormat("yyyy-MM-dd")} and ${until.toFormat("yyyy-MM-dd")}.`,
          { weekStart, meals: [], mealTypes },
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
      const resolveTypeName = resolveMealTypeName(ctx.deps["meal-type"]);
      const mealRows = ascending.map((meal) => mealToRow(meal, resolveTypeName(meal)));
      return toolResult(`${header}\n${renderMealsGroupedByDate(ascending, ctx.deps["meal-type"])}`, {
        weekStart,
        meals: mealRows,
        mealTypes,
      });
    };
  },
);
