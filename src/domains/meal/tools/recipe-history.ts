import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { errorResult, structuredResult } from "../../../shared/tools.js";
import { RecipeUidSchema } from "../../recipe/ids.js";
import { mealStartGuard } from "./guards.js";
import { mealRowSchema, resolveMealTypeName } from "./helpers.js";

// How many recent cooks to list. A summary, not a browse surface — "give me more"
// is search_meal_history's job (it paginates), so this is a fixed cap, not a param.
const RECENT_LIMIT = 10;

// Structured-output payload (ADR-0019, R1): the per-recipe cooking summary. Each
// recent cook carries its meal `uid` so the model can reschedule/delete that specific
// entry, and the recipe's own UID is echoed for chaining. The recent-cook entry is
// the `uid`/`date`/`typeName` slice of the shared `mealRowSchema` — same field names,
// so a meal identifier reads as `uid` across all three meal reads. A never-cooked
// recipe emits the zero-summary (lastCooked: null, timesCooked: 0, recent: []) — a
// valid empty success, not an error.
export const readRecipeHistoryOutputSchema = z.object({
  recipeUid: RecipeUidSchema,
  recipeName: z.string(),
  lastCooked: z.string().nullable().describe("Calendar day of the most recent past cook, yyyy-MM-dd, or null."),
  timesCooked: z.number().int().nonnegative(),
  recent: z.array(mealRowSchema.pick({ uid: true, date: true, typeName: true })),
});

/**
 * `read_recipe_history` — the per-recipe cooking SUMMARY (last cooked, times cooked,
 * recent dates), distinct from `search_meal_history`'s paged browse list. It lives in
 * the meal domain because the cook data is meal-owned (`MealStore.cookedHistory`):
 * recipe is dependency-free and meal already `dependsOn` recipe, so a recipe→meal edge
 * would be a build-time dependency cycle — "last cooked" stays meal-side.
 * Resolves the recipe name via `ctx.deps.recipe` and meal-type labels via
 * `ctx.deps["meal-type"]`.
 */
export const readRecipeHistoryTool = defineTool(
  {
    name: "read_recipe_history",
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
    outputSchema: readRecipeHistoryOutputSchema,
  },
  [mealStartGuard],
  (ctx: DomainCtx<MealState, "recipe" | "meal-type">) => {
    return async (args) => {
      const recipe = ctx.deps.recipe.get(args.recipe_uid);
      if (recipe === undefined) {
        return errorResult(
          `No recipe found with UID "${args.recipe_uid}". Check the UID (list_recipes / search_recipes), ` +
            "or it may still be syncing.",
        );
      }

      // Headline date from `lastCookedAt` (null ⇒ never cooked); the count + recent
      // list from `cookedHistory` (the same past-cook rule lastCookedAt heads).
      const lastCooked = ctx.state.store.lastCookedAt(args.recipe_uid);
      if (lastCooked === null) {
        // Never cooked is a valid empty success — the zero-summary, not an error.
        return structuredResult({
          recipeUid: args.recipe_uid,
          recipeName: recipe.name,
          lastCooked: null,
          timesCooked: 0,
          recent: [],
        });
      }

      const history = ctx.state.store.cookedHistory(args.recipe_uid);
      const resolveTypeName = resolveMealTypeName(ctx.deps["meal-type"]);
      const count = history.length;
      const recentMeals = history.slice(0, RECENT_LIMIT);

      const recent = recentMeals.map((meal) => ({
        uid: meal.uid,
        date: meal.date.slice(0, 10),
        typeName: resolveTypeName(meal),
      }));
      return structuredResult({
        recipeUid: args.recipe_uid,
        recipeName: recipe.name,
        lastCooked: lastCooked.slice(0, 10),
        timesCooked: count,
        recent,
      });
    };
  },
);
