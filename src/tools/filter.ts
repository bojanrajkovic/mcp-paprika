import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok, type Result } from "neverthrow";
import type { Recipe } from "../paprika/types.js";
import { parseDuration } from "../utils/duration.js";
import { coldStartGuard, textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";
import type { TimeConstraints } from "../cache/recipe-store.js";

export function registerFilterTools(server: McpServer, ctx: ServerContext): void {
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
        "Filter recipes by prep, cook, or total time. All constraints are optional. Results sorted by total time ascending.",
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
              return textResult(formatRecipeList(results, ctx));
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
  if (categoryNames.length > 0) {
    lines.push(`**Categories:** ${categoryNames.join(", ")}`);
  }
  const timeParts: Array<string> = [];
  if (recipe.prepTime) timeParts.push(`Prep: ${recipe.prepTime}`);
  if (recipe.totalTime) timeParts.push(`Total: ${recipe.totalTime}`);
  if (timeParts.length > 0) {
    lines.push(timeParts.join(" · "));
  }
  return lines.join("\n");
}
