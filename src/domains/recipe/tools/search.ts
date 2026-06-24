import { ok, type Result } from "neverthrow";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { RecipeState } from "../module.js";
import type { TimeConstraints } from "../store.js";
import type { Recipe } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { errorResult, structuredResult } from "../../../shared/tools.js";
import { parseDuration } from "../../../utils/duration.js";
import { browseContextSchema, recipeRowSchema, recipeToRow } from "../recipe-markdown.js";
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

// Structured-output payload (ADR-0019, R1): the matched recipe rows (capped at
// `limit`) plus `total`, the full match count before the cap — so the model can
// tell its results were truncated. `context` carries the source + the query term
// for the recipe-browse widget's header; the widget respects search ordering (no
// client re-sort).
export const searchRecipesOutputSchema = z.object({
  context: browseContextSchema,
  items: z.array(recipeRowSchema),
  total: z.number().int().nonnegative(),
});

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
    outputSchema: searchRecipesOutputSchema,
    // Hosts with the apps surface render this result as the recipe-browser widget; others
    // show the text/structured result unchanged.
    ui: { resourceUri: "ui://widget/recipe-browser" },
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
            return errorResult("Provide at least one of: query, ingredients, or a max prep/cook/total time.");
          }

          // The recipe-browse widget's source envelope: the free-text query (when present)
          // backs the "Results for '…'" header; an ingredient/time-only search carries none.
          const browseContext = hasQuery
            ? { source: "search" as const, query: args.query! }
            : { source: "search" as const };

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
            // No match is a valid empty success, not an error.
            return structuredResult({ context: browseContext, items: [], total: 0 });
          }

          // Resolve each row's category names once for the structured payload.
          const total = queryResults.length;
          const items = limited.map((r) =>
            recipeToRow(r.recipe, ctx.state.category.store.resolveNames(r.recipe.categories)),
          );

          return structuredResult({ context: browseContext, items, total });
        },
        (errorMsg) => errorResult(errorMsg),
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
