import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MealTypeUid } from "../ids.js";
import type { Meal } from "../meal/types.js";
import type { ServerContext } from "../types/server-context.js";

import { MealUidSchema } from "../ids.js";
import { parseCalendarDayWire } from "../utils/dates.js";
// pattern: Imperative Shell
import { toMessage } from "../utils/log.js";
import { textResult } from "./helpers.js";
import {
  commitMealsBatch,
  formatMealTypeResolveError,
  makeMealOrderFlagAssigner,
  mealStartGuard,
  mealTypeSpecSchema,
  renderMealCard,
  resolveMealTypeSpec,
} from "./meal-helpers.js";

// `.strict()`. Rescheduling is its own act because moving a meal's date moves it
// into the destination day's order_flag sequence (per-date), which a generic
// field edit on update_meal would not do — so `date` lives here, not there.
export const rescheduleMealInputSchema = z
  .object({
    uid: MealUidSchema,
    date: z
      .string()
      .min(1)
      .describe(
        "New meal date (ISO 8601 date or datetime). Time-of-day is dropped — meals are day-granular and " +
          "store at midnight UTC.",
      ),
    type: mealTypeSpecSchema
      .optional()
      .describe("Optionally also change the meal type while rescheduling (same DU as plan_meals)."),
  })
  .strict();

export function registerRescheduleMealTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "reschedule_meal" });
  server.registerTool(
    "reschedule_meal",
    {
      description:
        "Reschedule a planned meal to a different date by UID, optionally also changing its meal type. " +
        "Moving the date re-sequences the meal to the end of the destination day's order. To change a " +
        "meal's recipe link, freeform name, or scale instead, use update_meal.",
      inputSchema: rescheduleMealInputSchema,
    },
    async (args) => {
      log.info({ tool: "reschedule_meal", uid: args.uid, date: args.date }, "tool invoked");
      return mealStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = args.uid;
          const existing = ctx.mealStore.get(uid);

          if (existing === undefined) {
            if (ctx.mealStore.isTombstone(uid)) {
              return textResult(`Meal with UID "${uid}" is already deleted.`);
            }
            return textResult(`No meal found with UID "${uid}".`);
          }
          if (existing.deleted) {
            // Defense-in-depth
            return textResult(`Meal "${existing.name}" is already deleted.`);
          }

          // Resolve the optional type co-change (same DU + error wording as plan_meals / update_meal).
          let typeInteger: number | undefined;
          let typeUid: MealTypeUid | null | undefined;
          if (args.type !== undefined) {
            const result = resolveMealTypeSpec(ctx, args.type);
            if (!result.ok) {
              return textResult(formatMealTypeResolveError(result));
            }
            // Custom mealtypes carry originalType: null; Meal.type is vestigial when
            // type_uid is set (see plan_meals for the full rationale).
            typeInteger = result.resolved.originalType ?? 0;
            typeUid = result.resolved.uid;
          }

          // Normalize the destination date in its own calendar zone (see plan_meals).
          const normalizedDate = parseCalendarDayWire(args.date);
          if (normalizedDate === null) {
            return textResult(
              `Could not parse date "${args.date}". Use ISO 8601 (e.g., "2026-06-15") or "yyyy-MM-dd HH:mm:ss".`,
            );
          }

          const dateChanged = normalizedDate !== existing.date;

          // Nothing to do: same date and no type co-change. Avoid a wasted POST + notifySync.
          if (!dateChanged && args.type === undefined) {
            return textResult(renderMealCard(ctx, existing));
          }

          // When the date changes, the meal joins the destination date's order_flag
          // sequence (per-date — see makeMealOrderFlagAssigner) at that date's max+1, so
          // it can't collide with a meal already holding the old flag there. A pure
          // type co-change on the same date keeps the position. Old-date gaps are harmless.
          const assignFlag = makeMealOrderFlagAssigner(ctx);
          const newOrderFlag = dateChanged ? assignFlag(normalizedDate) : existing.orderFlag;

          const updated: Meal = {
            ...existing,
            date: normalizedDate,
            ...(typeInteger !== undefined && { type: typeInteger }),
            ...(typeUid !== undefined && { typeUid }),
            orderFlag: newOrderFlag,
          };

          let saved: Meal;
          try {
            const savedItems = await ctx.client.saveMeals([updated]);
            await commitMealsBatch(ctx, savedItems);
            saved = savedItems[0]!;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMeals failed");
            return textResult(`Failed to reschedule meal: ${message}`);
          }

          return textResult(renderMealCard(ctx, saved));
        },
        (guard) => guard,
      );
    },
  );
}
