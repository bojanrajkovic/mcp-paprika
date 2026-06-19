import { DateTime } from "luxon";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealTypeUid } from "../../meal-type/ids.js";
import type { RecipeUid } from "../../recipe/ids.js";
import type { MealState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { errorResult, toolResult } from "../../../shared/tools.js";
import { parseInstant } from "../../../utils/dates.js";
import { formatMealTypeResolveError, mealTypeSpecSchema } from "../../meal-type/meal-type-helpers.js";
import { RecipeUidSchema } from "../../recipe/ids.js";
import { mealStartGuard } from "./guards.js";
import { mealListOutputSchema, mealToStructuredRow, renderMealsGroupedByDate, resolveMealTypeName } from "./helpers.js";

export const searchMealHistoryInputSchema = z
  .object({
    recipe_uid: RecipeUidSchema.optional().describe("Recall past meals of this specific recipe, by UID."),
    class: z
      .string()
      .min(1)
      .optional()
      .describe('Recall meals whose recipe is in this category — a name (case-insensitive) or UID, e.g. "Italian".'),
    type: mealTypeSpecSchema
      .optional()
      .describe('Filter by meal type. Pick one shape: {"name":"Dinner"} | {"uid":"<MealType UID>"} | {"builtin":2}.'),
    since: z
      .string()
      .optional()
      .describe(
        "Start of the window, inclusive (ISO 8601 or yyyy-MM-dd). Defaults to 30 days ago when no recipe/class/type filter is given, else all time.",
      ),
    until: z
      .string()
      .optional()
      .describe(
        "End of the window, inclusive (ISO 8601 or yyyy-MM-dd). Defaults to today; future planner entries are excluded.",
      ),
    offset: z.number().int().nonnegative().optional().describe("Pagination offset (default 0)."),
    limit: z.number().int().positive().max(200).optional().describe("Maximum meals to return (default 50, max 200)."),
  })
  .strict();

// Structured-output payload (ADR-0019, R1): the shared `{ items }` wrapper extended
// with the pagination cursor the model needs to page — `total` is the full match
// count (pre-pagination), `offset` the page start. A zero-match search emits
// `{ items: [], total: 0, offset }` (a valid empty success); a bad filter or an
// over-paged offset is an `errorResult` instead (it is not a successful answer).
export const searchMealHistoryOutputSchema = mealListOutputSchema.extend({
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
});

/**
 * `search_meal_history` — paged browse of cooked-meal history, optionally filtered by
 * recipe class. The class (category) filter resolves the class name/UID to a
 * `CategoryUid` and then the set of recipe UIDs in it through `ctx.deps.recipe` —
 * categories are a recipe-domain concern, so meal needs NO `category` dep. Meal-type
 * resolution/render via `ctx.deps["meal-type"]`.
 */
export const searchMealHistoryTool = defineTool(
  {
    name: "search_meal_history",
    title: "Search past cooked meals by recipe or category",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      'Search PAST meals (recall/browse), by a specific recipe, a recipe category ("class"), a meal type, ' +
      'and/or a date window — any combination, ANDed. Answers "when did we last have tacos", "how often do ' +
      'we eat Italian", "show the dinners we had in March", or "what have we eaten lately". With no filters ' +
      "it returns the last 30 days. Future planner entries are excluded (use read_meal_plan for upcoming " +
      "meals). Results group by date (newest first), with a count, the last-made date, and pagination.",
    inputSchema: searchMealHistoryInputSchema,
    outputSchema: searchMealHistoryOutputSchema,
  },
  [mealStartGuard],
  (ctx: DomainCtx<MealState, "recipe" | "meal-type">) => {
    return async (args) => {
      // Optional meal-type filter (built-ins also surface legacy null-typeUid meals).
      let typeUid: MealTypeUid | undefined;
      let legacyTypeInteger: number | undefined;
      let typeName: string | undefined;
      if (args.type !== undefined) {
        const result = ctx.deps["meal-type"].resolveSpec(args.type);
        if (!result.ok) {
          return errorResult(formatMealTypeResolveError(result));
        }
        typeUid = result.resolved.uid;
        typeName = result.resolved.name;
        if (result.resolved.originalType !== null) {
          legacyTypeInteger = result.resolved.originalType;
        }
      }

      // Optional class (category) → the set of recipe UIDs in it. Category
      // resolution + the recipe-by-category query are recipe-domain concerns,
      // reached through `ctx.deps.recipe`. No category→recipe
      // index exists; recipe's contract does a linear scan internally.
      let classRecipeUids: Set<RecipeUid> | undefined;
      let classLabel: string | undefined;
      if (args.class !== undefined) {
        const { uids } = ctx.deps.recipe.resolveCategoryRefs([args.class]);
        if (uids.length === 0) {
          return errorResult(`No category found matching "${args.class}".`);
        }
        const catUid = uids[0]!;
        classLabel = ctx.deps.recipe.resolveCategoryNames([catUid])[0] ?? args.class;
        // recipe owns categories, so the category→recipe-UIDs membership query lives
        // on the recipe contract (recipesInCategory) rather than reaching its store —
        // mirroring the live `getAll().filter(r => r.categories.includes(catUid))`.
        classRecipeUids = new Set(ctx.deps.recipe.recipesInCategory(catUid));
      }

      // Combine recipe_uid + class into the store's recipeUids constraint (AND).
      let recipeUids: ReadonlySet<RecipeUid> | undefined;
      if (args.recipe_uid !== undefined && classRecipeUids !== undefined) {
        recipeUids = classRecipeUids.has(args.recipe_uid) ? new Set([args.recipe_uid]) : new Set();
      } else if (args.recipe_uid !== undefined) {
        recipeUids = new Set([args.recipe_uid]);
      } else {
        recipeUids = classRecipeUids;
      }

      const hasFilter = args.recipe_uid !== undefined || args.class !== undefined || args.type !== undefined;

      // Date window. Past-biased: `until` defaults to now (future excluded). With
      // no recipe/class/type filter and no explicit `since`, default to the last
      // 30 days; with a filter, search all time up to `until`.
      let until: DateTime;
      if (args.until !== undefined) {
        const parsed = parseInstant(args.until);
        if (parsed === null) {
          return errorResult(`Could not parse until date "${args.until}". Use yyyy-MM-dd or ISO 8601.`);
        }
        until = parsed.endOf("day");
      } else {
        until = DateTime.utc().endOf("day");
      }

      let since: DateTime | undefined;
      if (args.since !== undefined) {
        const parsed = parseInstant(args.since);
        if (parsed === null) {
          return errorResult(`Could not parse since date "${args.since}". Use yyyy-MM-dd or ISO 8601.`);
        }
        since = parsed.startOf("day");
      } else if (!hasFilter) {
        since = until.minus({ days: 30 }).startOf("day");
      }

      const offset = args.offset ?? 0;
      const limit = args.limit ?? 50;

      const { meals, total } = ctx.state.store.getInDateRange({
        since,
        until,
        ...(recipeUids !== undefined && { recipeUids }),
        ...(typeUid !== undefined && { typeUid }),
        ...(legacyTypeInteger !== undefined && { legacyTypeInteger }),
        offset,
        limit,
      });

      // Scope phrase for the header / empty message.
      const scopeParts: Array<string> = [];
      if (args.recipe_uid !== undefined) scopeParts.push(`recipe "${args.recipe_uid}"`);
      if (classLabel !== undefined) scopeParts.push(`category "${classLabel}"`);
      if (typeName !== undefined) scopeParts.push(`type "${typeName}"`);
      const scope = scopeParts.length > 0 ? ` for ${scopeParts.join(", ")}` : "";

      if (total === 0) {
        // Empty match is a valid empty success — carries the structured payload.
        return toolResult(`No past meals found${scope}.`, { items: [], total: 0, offset });
      }
      if (meals.length === 0) {
        // Over-paged: matches exist but this offset is past the end. Bad input, not an
        // empty answer — an errorResult with the remediation hint (the SDK exempts it).
        return errorResult(
          `No meals at offset ${offset.toString()} of ${total.toString()} total. ` +
            `Try a lower offset (the last page starts at offset ${Math.max(0, total - limit).toString()}).`,
        );
      }

      const sinceLabel = since !== undefined ? since.toFormat("yyyy-MM-dd") : null;
      const untilLabel = until.toFormat("yyyy-MM-dd");
      const rangeLabel = sinceLabel !== null ? `${sinceLabel} – ${untilLabel}` : `through ${untilLabel}`;

      // getInDateRange sorts newest-first, so at offset 0 the first meal is the
      // most recent match — i.e. "last made".
      const lastMade = offset === 0 ? meals[0]!.date.slice(0, 10) : null;

      const paged = !(offset === 0 && total <= limit);
      const countLabel = paged
        ? `Showing ${(offset + 1).toString()}–${(offset + meals.length).toString()} of ${total.toString()} past meals`
        : `${total.toString()} past meal${total === 1 ? "" : "s"}`;
      const header = `**${countLabel}${scope} (${rangeLabel})**${lastMade !== null ? ` · last made ${lastMade}` : ""}`;

      const resolveTypeName = resolveMealTypeName(ctx.deps["meal-type"]);
      const items = meals.map((meal) => mealToStructuredRow(meal, resolveTypeName(meal)));
      return toolResult(`${header}\n${renderMealsGroupedByDate(meals, ctx.deps["meal-type"])}`, {
        items,
        total,
        offset,
      });
    };
  },
);
