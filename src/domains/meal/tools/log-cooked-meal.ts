import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MealTypeUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealSelf } from "../module.js";
import type { Meal } from "../types.js";

import { MealUidSchema, RecipeUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { parseCalendarDayWire, todayWire } from "../../../utils/dates.js";
import { toMessage } from "../../../utils/log.js";
import { mealTypeSpecSchema, resolveOrCreateMealType } from "../../meal-type/meal-type-helpers.js";
import { makeMealOrderFlagAssigner, mealStartGuard, renderMealCard } from "./helpers.js";

export const logCookedMealInputSchema = z
  .object({
    recipe_uid: RecipeUidSchema.describe("UID of the recipe you cooked."),
    type: mealTypeSpecSchema
      .optional()
      .describe(
        'Meal type (defaults to Dinner). Pick one shape: {"name":"Dinner"} | {"uid":"<MealType UID>"} | {"builtin":2}.',
      ),
    date: z
      .string()
      .min(1)
      .optional()
      .describe("When it was cooked (ISO 8601 date or datetime). Defaults to today. Time-of-day is dropped."),
  })
  .strict();

/**
 * Registers `log_cooked_meal`, kernel-shaped — writes through
 * `ctx.self.commitMealsBatch`, resolves the recipe via `ctx.deps.recipe.get` and
 * the meal type via `resolveOrCreateMealType` (an unknown `{name}` auto-creates a custom type).
 */
export function logCookedMealTool(ctx: DomainCtx<MealSelf, "recipe" | "meal-type">): void {
  const log = ctx.infra.log.child({ component: "log_cooked_meal" });
  ctx.server.registerTool(
    "log_cooked_meal",
    {
      title: "Log a meal you cooked",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      description:
        "Log a meal you cooked: records the given recipe on the planner, defaulting to today and the Dinner " +
        "meal type — a quick way to keep your cooking history current. Pass `date` to log a different day or " +
        "`type` for a non-dinner meal. To log a freeform (non-recipe) meal or to plan ahead in bulk, use plan_meals.",
      inputSchema: logCookedMealInputSchema,
    },
    async (args) => {
      log.info({ tool: "log_cooked_meal", recipe_uid: args.recipe_uid }, "tool invoked");
      return mealStartGuard(ctx.self, ctx.deps["meal-type"]).match(
        async (): Promise<CallToolResult> => {
          // Date defaults to today; a supplied date snaps to its own-zone calendar
          // day (same normalization as plan_meals).
          let date: string;
          if (args.date === undefined) {
            date = todayWire();
          } else {
            const parsed = parseCalendarDayWire(args.date);
            if (parsed === null) {
              return textResult(
                `Could not parse date "${args.date}". Use ISO 8601 (e.g., "2026-06-15") or "yyyy-MM-dd HH:mm:ss".`,
              );
            }
            date = parsed;
          }

          const recipe = ctx.deps.recipe.get(args.recipe_uid);
          if (recipe === undefined) {
            return textResult(
              `recipe_uid "${args.recipe_uid}" is not known to the local recipe store; ` +
                `wait for the next sync and retry, or log it with plan_meals as a freeform meal.`,
            );
          }

          // Resolve the meal type LAST — after the date and recipe validations above. An
          // unknown {name} auto-creates a type, so creating only once the rest of the input
          // is known-good avoids leaving an orphan type behind on a rejected call.
          // Type defaults to Dinner (the common case for a cooked meal).
          const typeSpec: z.infer<typeof mealTypeSpecSchema> = args.type ?? { builtin: 2 };
          const typeResult = await resolveOrCreateMealType(ctx.deps["meal-type"], typeSpec);
          if (!typeResult.ok) {
            return textResult(typeResult.message);
          }
          // Custom mealtypes carry originalType: null; Meal.type is vestigial when
          // type_uid is set (see plan_meals for the full rationale).
          const typeInteger = typeResult.resolved.originalType ?? 0;
          const typeUid: MealTypeUid = typeResult.resolved.uid;

          const meal: Meal = {
            uid: MealUidSchema.parse(crypto.randomUUID().toUpperCase()),
            recipeUid: args.recipe_uid,
            name: recipe.name,
            date,
            type: typeInteger,
            typeUid,
            orderFlag: makeMealOrderFlagAssigner(ctx.self)(date),
            isIngredient: false,
            scale: null,
            deleted: false,
          };

          let saved: Meal;
          try {
            const savedItems = await ctx.infra.client.saveMeals([meal]);
            await ctx.self.commitMealsBatch(savedItems);
            saved = savedItems[0]!;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, recipe_uid: args.recipe_uid }, "saveMeals failed");
            return textResult(`Failed to log cooked meal: ${message}`);
          }

          return textResult(`Logged.\n\n${renderMealCard(saved, ctx.deps.recipe, ctx.deps["meal-type"])}`);
        },
        (guard) => guard,
      );
    },
  );
}
