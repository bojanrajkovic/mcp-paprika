import { ok, type Result } from "neverthrow";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";
import type { TimeConstraints } from "../store.js";
import type { Recipe } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { parseDuration } from "../../../utils/duration.js";
import { recipeMetadataLines } from "../recipe-markdown.js";
import { recipeColdStartGuard } from "./guards.js";

export const searchRecipesInputSchema = z
  .object({
    query: z.string().optional().describe("Free-text search across name, ingredients, and description"),
    ingredients: z.array(z.string().min(1)).optional().describe("Ingredient terms to filter by"),
    match: z
      .enum(["all", "any"])
      .default("all")
      .describe('Ingredient match mode: "all" (default) requires every term; "any" matches at least one'),
    maxPrep: z.string().optional().describe('Maximum prep time (e.g., "30 minutes", "1 hr")'),
    maxCook: z.string().optional().describe('Maximum cook time (e.g., "45 min", "1 hour")'),
    maxTotal: z.string().optional().describe('Maximum total time (e.g., "1 hour 30 minutes", "2 hrs")'),
    limit: z
      .number()
      .int()
      .positive()
      .max(50)
      .optional()
      .default(20)
      .describe("Maximum number of results to return (default: 20, max: 50)"),
  })
  // Plain `.strict()` — NOT `.superRefine`/`.refine`. A refined schema is a
  // ZodEffects, which the MCP SDK serializes to an EMPTY published inputSchema
  // (it reads `.shape`, which only a plain object has), so the model would see
  // search_recipes as taking no arguments. The "at least one criterion" rule is
  // therefore enforced at runtime in the handler, not on the schema.
  .strict();

/**
 * `search_recipes` — search recipes by name / ingredient / description / time. The
 * `lastCookedAt` enrichment is DROPPED — recipe is `dependsOn []` (no meal
 * dependency); "last cooked" stays meal-side, surfaced by the meal domain's
 * `read_recipe_history` tool.
 */
export const searchRecipesTool = defineTool(
  {
    name: "search_recipes",
    title: "Search recipes by name, ingredient, or time",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Search and filter recipes. Use any combination of: free-text query (matches name, " +
      "ingredients, description), an ingredient list with all/any match mode, and/or max " +
      "prep/cook/total time constraints. At least one criterion is required. Results are " +
      "ranked by query relevance when a query is present, or by ascending total time when " +
      "only time constraints are given.",
    inputSchema: searchRecipesInputSchema,
  },
  [recipeColdStartGuard],
  (ctx: DomainCtx<RecipeState, never>) => {
    return async (args) => {
      // Parse time constraints first — an unparseable max is an early error.
      const constraintsResult = parseMaybeMinutes(args.maxPrep).andThen((maxPrepTime) =>
        parseMaybeMinutes(args.maxCook).andThen((maxCookTime) =>
          parseMaybeMinutes(args.maxTotal).map((maxTotalTime): TimeConstraints => {
            const base = {} as TimeConstraints;
            return Object.assign(base, {
              ...(maxPrepTime !== undefined && { maxPrepTime }),
              ...(maxCookTime !== undefined && { maxCookTime }),
              ...(maxTotalTime !== undefined && { maxTotalTime }),
            });
          }),
        ),
      );

      return constraintsResult.match(
        (constraints) => {
          const hasQuery = args.query !== undefined && args.query.length > 0;
          const hasIngredients = args.ingredients !== undefined && args.ingredients.length > 0;
          const hasTime =
            constraints.maxPrepTime !== undefined ||
            constraints.maxCookTime !== undefined ||
            constraints.maxTotalTime !== undefined;

          // The ">=1 criterion" rule lives here (not on the schema — see the
          // searchRecipesInputSchema comment): reject an all-empty call so search
          // never silently returns the whole library.
          if (!hasQuery && !hasIngredients && !hasTime) {
            return textResult("Provide at least one of: query, ingredients, or a max prep/cook/total time.");
          }

          // Build candidate set from the search/getAll path.
          let queryResults: Array<{ recipe: Recipe; score?: number }>;
          if (hasQuery) {
            // search() returns scored results, no limit yet — we limit after intersection.
            queryResults = ctx.state.recipe.store.search(args.query!, {});
          } else {
            // No free-text query: start from all recipes (scored undefined).
            queryResults = ctx.state.recipe.store.getAll().map((recipe) => ({ recipe }));
          }

          // Intersect with ingredient filter.
          if (hasIngredients) {
            const ingredientSet = new Set(
              ctx.state.recipe.store.filterByIngredients(args.ingredients!, args.match).map((r) => r.uid),
            );
            queryResults = queryResults.filter((r) => ingredientSet.has(r.recipe.uid));
          }

          // Time filter: filterByTime returns recipes already sorted ascending by
          // total time. Compute it ONCE and reuse for both the intersection set and
          // the order map (it was previously scanned twice per request).
          const timeOrdered = hasTime ? ctx.state.recipe.store.filterByTime(constraints) : null;
          if (timeOrdered !== null) {
            const timeSet = new Set(timeOrdered.map((r) => r.uid));
            queryResults = queryResults.filter((r) => timeSet.has(r.recipe.uid));
          }

          // Sort: scored search order when query present; ascending total-time
          // order when only time active; name order otherwise.
          if (!hasQuery) {
            if (timeOrdered !== null) {
              const timeOrderMap = new Map(timeOrdered.map((r, i) => [r.uid, i]));
              queryResults.sort((a, b) => {
                const ai = timeOrderMap.get(a.recipe.uid) ?? Number.MAX_SAFE_INTEGER;
                const bi = timeOrderMap.get(b.recipe.uid) ?? Number.MAX_SAFE_INTEGER;
                return ai - bi;
              });
            } else {
              queryResults.sort((a, b) => a.recipe.name.localeCompare(b.recipe.name));
            }
          }

          // Apply limit post-intersection.
          const limited = queryResults.slice(0, args.limit);

          if (limited.length === 0) {
            const criteria: Array<string> = [];
            if (hasQuery) criteria.push(`query "${args.query!}"`);
            if (hasIngredients) criteria.push(`ingredients [${args.ingredients!.join(", ")}]`);
            if (args.maxPrep !== undefined) criteria.push(`maxPrep "${args.maxPrep}"`);
            if (args.maxCook !== undefined) criteria.push(`maxCook "${args.maxCook}"`);
            if (args.maxTotal !== undefined) criteria.push(`maxTotal "${args.maxTotal}"`);
            return textResult(`No recipes found matching ${criteria.join(", ")}.`);
          }

          const lines = limited.map((r) => {
            const categoryNames = ctx.state.category.store.resolveNames(r.recipe.categories);
            const base = formatRecipeItem(r.recipe, categoryNames);
            if (!hasTime) return base;
            const unverified = unverifiedTimeFields(r.recipe, constraints);
            if (unverified.length === 0) return base;
            return (
              `${base}\n> ⚠️ _Time unverified — couldn't parse this recipe's ${unverified.join(" / ")} against your ` +
              `limit, so it's shown rather than hidden. Check the displayed time before relying on it._`
            );
          });

          return textResult(lines.join("\n\n---\n\n"));
        },
        (errorMsg) => textResult(errorMsg),
      );
    };
  },
);

// ---------------------------------------------------------------------------
// Private helpers (moved from filter.ts)
// ---------------------------------------------------------------------------

// Parses a human-readable time string to minutes, or passes through undefined.
// Returns Err with a user-friendly message if parsing fails.
function parseMaybeMinutes(input: string | undefined): Result<number | undefined, string> {
  if (input === undefined) return ok(undefined);
  return parseDuration(input)
    .map((d) => d.as("minutes"))
    .mapErr((e) => `Invalid time format "${e.input}": ${e.reason}`);
}

function formatRecipeItem(recipe: Recipe, categoryNames: Array<string>): string {
  const lines: Array<string> = [];
  lines.push(`## ${recipe.name}`);
  lines.push(`UID: \`${recipe.uid}\``);
  if (categoryNames.length > 0) {
    lines.push(`**Categories:** ${categoryNames.join(", ")}`);
  }
  lines.push(...recipeMetadataLines(recipe));
  return lines.join("\n");
}

// Which active time constraints could NOT be confirmed for this recipe. A recipe
// is "verified" against a constraint only when its corresponding field parses —
// inclusion already guarantees it's within the bound, since the store excludes
// parse-and-exceed recipes. A null or unparseable field (free-text like
// "5+ hours" or "overnight") is kept (the store stays lenient — AC5.5 / issue
// #162) but can't be confirmed, so search_recipes flags it as advisory rather
// than silently presenting it as a clean match.
function unverifiedTimeFields(recipe: Recipe, constraints: TimeConstraints): Array<string> {
  const unverified: Array<string> = [];
  const check = (max: number | undefined, value: string | null, label: string): void => {
    if (max === undefined) return;
    const parses =
      value !== null &&
      parseDuration(value).match(
        () => true,
        () => false,
      );
    if (!parses) unverified.push(label);
  };
  check(constraints.maxPrepTime, recipe.prepTime, "prep time");
  check(constraints.maxCookTime, recipe.cookTime, "cook time");
  check(constraints.maxTotalTime, recipe.totalTime, "total time");
  return unverified;
}
