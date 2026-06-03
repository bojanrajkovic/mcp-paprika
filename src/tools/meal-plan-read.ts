import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DateTime } from "luxon";
import { z } from "zod";

import type { ServerContext } from "../types/server-context.js";

import { textResult } from "./helpers.js";
import { mealStartGuard, renderMealsGroupedByDate } from "./meal-helpers.js";

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

export function registerReadMealPlanTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "read_meal_plan" });
  server.registerTool(
    "read_meal_plan",
    {
      annotations: { readOnlyHint: true, idempotentHint: true },
      description:
        "Read the upcoming meal plan: meals scheduled from today forward, grouped by day in ascending date " +
        'order (today first). Defaults to the next 7 days; pass `days` to widen the window. For past meals or recall ("when did we last have X"), use search_meal_history.',
      inputSchema: readMealPlanInputSchema,
    },
    async (args) => {
      log.info({ tool: "read_meal_plan", days: args.days }, "tool invoked");
      return mealStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
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
          const { meals } = ctx.mealStore.getInDateRange({ since, until, offset: 0, limit: 500 });

          if (meals.length === 0) {
            return textResult(
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
          return textResult(`${header}\n${renderMealsGroupedByDate(ctx, ascending)}`);
        },
        (guard) => guard,
      );
    },
  );
}
