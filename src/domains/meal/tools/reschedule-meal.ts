import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MealTypeUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealSelf } from "../module.js";
import type { Meal } from "../types.js";

import { MealUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { parseCalendarDayWire } from "../../../utils/dates.js";
import { toMessage } from "../../../utils/log.js";
import { mealTypeSpecSchema, resolveOrCreateMealType } from "../../meal-type/meal-type-helpers.js";
import { makeMealOrderFlagAssigner, mealStartGuard, renderMealCard } from "./helpers.js";

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

/**
 * Registers `reschedule_meal`, kernel-shaped — writes through
 * `ctx.self.commitMealsBatch`, resolves the optional type co-change via
 * `resolveOrCreateMealType` (an unknown `{name}` auto-creates a custom type).
 */
export function rescheduleMealTool(ctx: DomainCtx<MealSelf, "recipe" | "meal-type">): void {
  const log = ctx.infra.log.child({ component: "reschedule_meal" });
  ctx.server.registerTool(
    "reschedule_meal",
    {
      title: "Reschedule a planned meal",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
      description:
        "Reschedule a planned meal to a different date by UID, optionally also changing its meal type. " +
        "Moving the date re-sequences the meal to the end of the destination day's order. To change a " +
        "meal's recipe link, freeform name, or scale instead, use update_meal.",
      inputSchema: rescheduleMealInputSchema,
    },
    async (args) => {
      log.info({ tool: "reschedule_meal", uid: args.uid, date: args.date }, "tool invoked");
      return mealStartGuard(ctx.self, ctx.deps["meal-type"]).match(
        async (): Promise<CallToolResult> => {
          const uid = args.uid;
          const existing = ctx.self.store.get(uid);

          if (existing === undefined) {
            return textResult(`No meal found with UID "${uid}" (it may not exist or was already deleted).`);
          }

          // Resolve the optional type co-change (same DU + error wording as plan_meals / update_meal).
          let typeInteger: number | undefined;
          let typeUid: MealTypeUid | null | undefined;
          if (args.type !== undefined) {
            const result = await resolveOrCreateMealType(ctx.deps["meal-type"], args.type);
            if (!result.ok) {
              return textResult(result.message);
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
            return textResult(renderMealCard(existing, ctx.deps.recipe, ctx.deps["meal-type"]));
          }

          // When the date changes, the meal joins the destination date's order_flag
          // sequence (per-date — see makeMealOrderFlagAssigner) at that date's max+1, so
          // it can't collide with a meal already holding the old flag there. A pure
          // type co-change on the same date keeps the position. Old-date gaps are harmless.
          const assignFlag = makeMealOrderFlagAssigner(ctx.self);
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
            const savedItems = await ctx.infra.client.saveMeals([updated]);
            await ctx.self.commitMealsBatch(savedItems);
            saved = savedItems[0]!;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMeals failed");
            return textResult(`Failed to reschedule meal: ${message}`);
          }

          return textResult(renderMealCard(saved, ctx.deps.recipe, ctx.deps["meal-type"]));
        },
        (guard) => guard,
      );
    },
  );
}
