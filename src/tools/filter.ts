import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type Result } from "neverthrow";
import type { Recipe } from "../paprika/types.js";
import { parseDuration } from "../utils/duration.js";
import { coldStartGuard, recipeMetadataLines, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";
import type { TimeConstraints } from "../cache/recipe-store.js";

export function registerFilterTools(server: McpServer, ctx: ServerContext): void {
  const logIngredient = ctx.log.child({ component: "filter_by_ingredient" });
  const logTime = ctx.log.child({ component: "filter_by_time" });
  server.registerTool(
    "filter_by_ingredient",
    {
      description:
        'Filter recipes by ingredient. Use mode="all" (default) to require all ingredients, or mode="any" to match any.',
      inputSchema: {
        ingredients: z.array(z.string()).min(1).describe("One or more ingredient terms to filter by"),
        mode: z
          .enum(["all", "any"])
          .default("all")
          .describe('Match mode: "all" (default) requires every ingredient; "any" matches at least one'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(20)
          .describe("Maximum number of results to return (default: 20, max: 50)"),
      },
    },
    async (args) => {
      logIngredient.info({ tool: "filter_by_ingredient", ...args }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const results = ctx.store.filterByIngredients(args.ingredients, args.mode, args.limit);
          if (results.length === 0) {
            const qualifier = args.mode === "all" ? "all of" : "any of";
            return textResult(`No recipes found containing ${qualifier}: ${args.ingredients.join(", ")}.`);
          }
          return textResult(formatRecipeList(results, ctx));
        },
        (guard) => guard,
      );
    },
  );

  server.registerTool(
    "filter_by_time",
    {
      description:
        "Filter recipes by prep, cook, or total time. All constraints are optional; results are sorted by " +
        "total time ascending. ADVISORY: a recipe whose relevant time can't be parsed (free-text like " +
        '"5+ hours" or "overnight") is NOT hidden — it is included and flagged "Time unverified" so quick ' +
        "recipes with odd time strings aren't silently dropped. For any flagged result, check the displayed " +
        "time yourself rather than trusting the filter for that one.",
      inputSchema: {
        maxPrepTime: z.string().optional().describe('Maximum prep time (e.g., "30 minutes", "1 hr")'),
        maxCookTime: z.string().optional().describe('Maximum cook time (e.g., "45 min", "1 hour")'),
        maxTotalTime: z.string().optional().describe('Maximum total time (e.g., "1 hour 30 minutes", "2 hrs")'),
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional()
          .default(20)
          .describe("Maximum number of results to return (default: 20, max: 50)"),
      },
    },
    async (args) => {
      logTime.info({ tool: "filter_by_time", ...args }, "tool invoked");
      return coldStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const constraintsResult = parseMaybeMinutes(args.maxPrepTime).andThen((maxPrepTime) =>
            parseMaybeMinutes(args.maxCookTime).andThen((maxCookTime) =>
              parseMaybeMinutes(args.maxTotalTime).map((maxTotalTime): TimeConstraints => {
                // Build object using spread operator to satisfy exactOptionalPropertyTypes
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
              const allResults = ctx.store.filterByTime(constraints);
              const results = allResults.slice(0, args.limit);
              if (results.length === 0) {
                return textResult("No recipes found matching the specified time constraints.");
              }
              return textResult(formatTimeFilterResults(results, ctx, constraints));
            },
            (errorMsg) => textResult(errorMsg),
          );
        },
        (guard) => guard,
      );
    },
  );
}

// Parses a human-readable time string to minutes, or passes through undefined.
// Returns Err with a user-friendly message if parsing fails.
function parseMaybeMinutes(input: string | undefined): Result<number | undefined, string> {
  if (input === undefined) return ok(undefined);
  return parseDuration(input)
    .map((d) => d.as("minutes"))
    .mapErr((e) => `Invalid time format "${e.input}": ${e.reason}`);
}

function formatRecipeList(recipes: Array<Recipe>, ctx: ServerContext): string {
  const lines = recipes.map((recipe) => {
    const categoryNames = ctx.store.resolveCategories(recipe.categories);
    return formatRecipeItem(recipe, categoryNames);
  });
  return lines.join("\n\n---\n\n");
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
// #162) but can't be confirmed, so filter_by_time flags it as advisory rather
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

// filter_by_time-specific renderer: same item formatting as filter_by_ingredient,
// plus a one-line "Time unverified" advisory appended to any recipe whose time
// couldn't be confirmed against the active constraints.
function formatTimeFilterResults(recipes: Array<Recipe>, ctx: ServerContext, constraints: TimeConstraints): string {
  return recipes
    .map((recipe) => {
      const categoryNames = ctx.store.resolveCategories(recipe.categories);
      const item = formatRecipeItem(recipe, categoryNames);
      const unverified = unverifiedTimeFields(recipe, constraints);
      if (unverified.length === 0) return item;
      return (
        `${item}\n> ⚠️ _Time unverified — couldn't parse this recipe's ${unverified.join(" / ")} against your ` +
        `limit, so it's shown rather than hidden. Check the displayed time before relying on it._`
      );
    })
    .join("\n\n---\n\n");
}
