import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealTypeApi } from "../../meal-type/api.js";
import type { MealSelf } from "../module.js";
import type { Meal } from "../types.js";

import { RecipeUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { mealStartGuard } from "./helpers.js";

// How many recent cooks to list. A summary, not a browse surface — "give me more"
// is search_meal_history's job (it paginates), so this is a fixed cap, not a param.
const RECENT_LIMIT = 10;

/**
 * A meal → meal-type-name resolver, maps built ONCE for reuse across the recent
 * list. typeUid is the primary key; legacy meals (typeUid: null) fall back to the
 * `type` integer via `originalType`; an unresolved type renders `Type N`. A local
 * copy of the resolution in `renderMealsGroupedByDate` — kept inline here rather
 * than extracted, since this is only its second use (copy first, abstract later).
 */
function makeTypeLabeler(mealType: MealTypeApi): (meal: Readonly<Meal>) => string {
  const byUid = new Map<string, string>();
  const byOriginalType = new Map<number, string>();
  for (const mt of mealType.getAll()) {
    byUid.set(mt.uid, mt.name);
    if (mt.originalType !== null) byOriginalType.set(mt.originalType, mt.name);
  }
  return (meal) => {
    const lookup = meal.typeUid !== null ? byUid.get(meal.typeUid) : byOriginalType.get(meal.type);
    return lookup ?? `Type ${meal.type.toString()}`;
  };
}

/**
 * Registers `read_recipe_history`, kernel-shaped — the per-recipe cooking SUMMARY
 * (last cooked, times cooked, recent dates), distinct from `search_meal_history`'s
 * paged browse list. It lives in the meal domain because the cook data is
 * meal-owned (`MealStore.cookedHistory`); recipe is dependency-free and meal
 * already `dependsOn` recipe, so a recipe→meal edge would be a build-time
 * dependency cycle — "last cooked" stays meal-side (ADR-0009). Reads meal data via
 * `ctx.self.store`; resolves the recipe name via `ctx.deps.recipe` and meal-type
 * labels via `ctx.deps["meal-type"]`.
 */
export function readRecipeHistoryTool(ctx: DomainCtx<MealSelf, "recipe" | "meal-type">): void {
  const log = ctx.infra.log.child({ component: "read_recipe_history" });
  ctx.server.registerTool(
    "read_recipe_history",
    {
      title: "Read a recipe's cooking history",
      annotations: { readOnlyHint: true, idempotentHint: true },
      description:
        "Summarize ONE recipe's cooking history: when it was last cooked, how many times " +
        'total, and its most recent cooking dates (with meal type). Answers "when did I last ' +
        'make this", "have we cooked this before", "how often do we make it". Look the recipe ' +
        "up by UID (from list_recipes, search_recipes, or read_recipe). Only PAST cooks count — " +
        "future planner entries are excluded (use read_meal_plan for what's scheduled). For the " +
        "full meal-by-meal list, or to filter cooking history by category, meal type, or date " +
        "window, use search_meal_history.",
      inputSchema: {
        recipe_uid: RecipeUidSchema.describe(
          "The recipe to summarize, by UID (from list_recipes, search_recipes, or read_recipe).",
        ),
      },
    },
    async (args) => {
      log.info({ tool: "read_recipe_history", recipe_uid: args.recipe_uid }, "tool invoked");
      return mealStartGuard(ctx.self, ctx.deps["meal-type"]).match(
        async (): Promise<CallToolResult> => {
          const recipe = ctx.deps.recipe.get(args.recipe_uid);
          if (recipe === undefined) {
            return textResult(
              `No recipe found with UID "${args.recipe_uid}". Check the UID (list_recipes / search_recipes), ` +
                "or it may still be syncing.",
            );
          }

          // Headline date from `lastCookedAt` (null ⇒ never cooked); the count + recent
          // list from `cookedHistory` (the same past-cook rule lastCookedAt heads).
          const lastCooked = ctx.self.store.lastCookedAt(args.recipe_uid);
          if (lastCooked === null) {
            return textResult(
              `**${recipe.name}** has no cooking history yet. ` +
                "Use plan_meals to schedule it or log_cooked_meal to record a past cooking.",
            );
          }

          const history = ctx.self.store.cookedHistory(args.recipe_uid);
          const labelType = makeTypeLabeler(ctx.deps["meal-type"]);
          const count = history.length;

          const lines: Array<string> = [];
          lines.push(`**${recipe.name}** — cooking history`);
          lines.push("");
          lines.push(
            `Last cooked: ${lastCooked.slice(0, 10)} · cooked ${count.toString()} time${count === 1 ? "" : "s"}`,
          );
          lines.push("");
          lines.push("Recent:");
          for (const meal of history.slice(0, RECENT_LIMIT)) {
            lines.push(`- ${meal.date.slice(0, 10)} · ${labelType(meal)}`);
          }
          if (count > RECENT_LIMIT) {
            lines.push("");
            lines.push(`_Showing ${RECENT_LIMIT.toString()} most recent of ${count.toString()}._`);
          }

          return textResult(lines.join("\n"));
        },
        (guard) => guard,
      );
    },
  );
}
