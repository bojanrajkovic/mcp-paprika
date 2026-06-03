import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { MealTypeUid } from "../ids.js";
import type { Meal } from "../meal/types.js";
import type { ServerContext } from "../types/server-context.js";

import { MealUidSchema, RecipeUidSchema } from "../ids.js";
import { parseCalendarDayWire, todayWire } from "../utils/dates.js";
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

export function registerLogCookedMealTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "log_cooked_meal" });
  server.registerTool(
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
      return mealStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Type defaults to Dinner (the common case for a cooked meal).
          const typeSpec: z.infer<typeof mealTypeSpecSchema> = args.type ?? { builtin: 2 };
          const typeResult = resolveMealTypeSpec(ctx, typeSpec);
          if (!typeResult.ok) {
            return textResult(formatMealTypeResolveError(typeResult));
          }
          // Custom mealtypes carry originalType: null; Meal.type is vestigial when
          // type_uid is set (see plan_meals for the full rationale).
          const typeInteger = typeResult.resolved.originalType ?? 0;
          const typeUid: MealTypeUid = typeResult.resolved.uid;

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

          const recipe = ctx.store.get(args.recipe_uid);
          if (recipe === undefined) {
            return textResult(
              `recipe_uid "${args.recipe_uid}" is not known to the local recipe store; ` +
                `wait for the next sync and retry, or log it with plan_meals as a freeform meal.`,
            );
          }

          const meal: Meal = {
            uid: MealUidSchema.parse(crypto.randomUUID().toUpperCase()),
            recipeUid: args.recipe_uid,
            name: recipe.name,
            date,
            type: typeInteger,
            typeUid,
            orderFlag: makeMealOrderFlagAssigner(ctx)(date),
            isIngredient: false,
            scale: null,
            deleted: false,
          };

          let saved: Meal;
          try {
            const savedItems = await ctx.client.saveMeals([meal]);
            await commitMealsBatch(ctx, savedItems);
            saved = savedItems[0]!;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, recipe_uid: args.recipe_uid }, "saveMeals failed");
            return textResult(`Failed to log cooked meal: ${message}`);
          }

          return textResult(`Logged.\n\n${renderMealCard(ctx, saved)}`);
        },
        (guard) => guard,
      );
    },
  );
}
