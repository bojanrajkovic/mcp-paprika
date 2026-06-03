import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DateTime } from "luxon";
import { z } from "zod";

import type { RecipeUid } from "../ids.js";
import type { Meal } from "../meal/types.js";
import type { ServerContext } from "../types/server-context.js";

import { RecipeUidSchema } from "../ids.js";
import { resolveCategoryRefs, textResult } from "./helpers.js";
import { mealStartGuard, renderMealsGroupedByDate } from "./meal-helpers.js";

export const searchMealHistoryInputSchema = z
  .object({
    recipe_uid: RecipeUidSchema.optional().describe("Recall past meals of this specific recipe, by UID."),
    class: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Recall past meals whose recipe is in this category — a category name (case-insensitive) or UID, e.g. "Italian".',
      ),
  })
  .strict();

export function registerSearchMealHistoryTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "search_meal_history" });
  server.registerTool(
    "search_meal_history",
    {
      description:
        'Search PAST meals (recall), by a specific recipe and/or by recipe category ("class"). Answers ' +
        '"when did we last have tacos" (recipe_uid) or "how often do we eat Italian" (class); supplying both ' +
        "ANDs them (that recipe, only if it is in that class). Future planner entries are excluded. Returns " +
        "the matching meals grouped by date (newest first), the total count, and when it was last made. For " +
        "the upcoming plan, use read_meal_plan.",
      inputSchema: searchMealHistoryInputSchema,
    },
    async (args) => {
      log.info({ tool: "search_meal_history", recipe_uid: args.recipe_uid, class: args.class }, "tool invoked");
      return mealStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (args.recipe_uid === undefined && args.class === undefined) {
            return textResult("Provide at least one of recipe_uid or class to search by.");
          }

          // Resolve the optional class to the set of recipe UIDs in that category.
          // No category→recipe index exists; a linear scan is fine for a personal
          // library (D3 in ADR-0008).
          let classRecipeUids: Set<RecipeUid> | null = null;
          let classLabel: string | null = null;
          if (args.class !== undefined) {
            const { uids } = resolveCategoryRefs(ctx.categoryStore.getAll(), [args.class]);
            if (uids.length === 0) {
              return textResult(`No category found matching "${args.class}".`);
            }
            const catUid = uids[0]!;
            classLabel = ctx.categoryStore.resolveNames([catUid])[0] ?? args.class;
            classRecipeUids = new Set(
              ctx.store
                .getAll()
                .filter((r) => r.categories.includes(catUid))
                .map((r) => r.uid),
            );
          }

          // Candidate recipe UIDs = recipe_uid AND/OR class membership.
          let candidateUids: Set<RecipeUid>;
          if (args.recipe_uid !== undefined && classRecipeUids !== null) {
            candidateUids = classRecipeUids.has(args.recipe_uid) ? new Set([args.recipe_uid]) : new Set();
          } else if (args.recipe_uid !== undefined) {
            candidateUids = new Set([args.recipe_uid]);
          } else {
            candidateUids = classRecipeUids ?? new Set();
          }

          // Collect PAST meals (date <= now) for the candidate recipes. "History"
          // is what was actually eaten, so future planner entries are excluded.
          const now = DateTime.utc();
          const matches: Array<Meal> = [];
          for (const uid of candidateUids) {
            for (const meal of ctx.mealStore.getByRecipeUid(uid)) {
              const dt = DateTime.fromFormat(meal.date, "yyyy-MM-dd HH:mm:ss", { zone: "utc" });
              if (!dt.isValid || dt > now) continue;
              matches.push(meal);
            }
          }

          if (matches.length === 0) {
            const what =
              args.recipe_uid !== undefined && classLabel !== null
                ? `recipe "${args.recipe_uid}" in category "${classLabel}"`
                : args.recipe_uid !== undefined
                  ? `recipe "${args.recipe_uid}"`
                  : `category "${classLabel ?? ""}"`;
            return textResult(`No past meals found for ${what}.`);
          }

          // Newest-first for recall. last-made = the most recent past date.
          matches.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.type - b.type));
          const lastMade = matches[0]!.date.slice(0, 10);
          const count = matches.length;

          const scope =
            classLabel !== null
              ? args.recipe_uid !== undefined
                ? ` (recipe in "${classLabel}")`
                : ` in "${classLabel}"`
              : "";
          const header = `**${count.toString()} past meal${count === 1 ? "" : "s"}${scope}** · last made ${lastMade}`;
          return textResult(`${header}\n${renderMealsGroupedByDate(ctx, matches)}`);
        },
        (guard) => guard,
      );
    },
  );
}
