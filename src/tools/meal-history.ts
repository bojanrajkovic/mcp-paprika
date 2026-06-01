import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DateTime } from "luxon";
import { z } from "zod";
import { mealStartGuard, mealTypeSpecSchema, resolveMealTypeSpec } from "./meal-helpers.js";
import { textResult } from "./helpers.js";
import { parseInstant } from "../utils/dates.js";
import { RecipeUidSchema } from "../paprika/types.js";
import type { ServerContext } from "../types/server-context.js";
import type { Meal, MealTypeUid } from "../paprika/types.js";

function formatMealLine(
  meal: Meal,
  typeNames: Map<string, string>,
  typeByOriginalType: Map<number, string>,
): { typeName: string; entry: string } {
  // typeUid is the primary lookup, but older meals (predating Paprika's
  // mealtypes catalog) carry typeUid: null and rely on the `type` integer
  // (which corresponds to MealType.originalType in the catalog).
  const lookup = meal.typeUid !== null ? typeNames.get(meal.typeUid) : typeByOriginalType.get(meal.type);
  const typeName = lookup ?? `Type ${meal.type.toString()}`;
  const isFreeform = meal.recipeUid === null || meal.recipeUid === "";
  const entry = isFreeform ? `${meal.name} *(freeform)*` : meal.name;
  return { typeName, entry };
}

export function registerMealHistoryTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "list_meal_history" });
  server.registerTool(
    "list_meal_history",
    {
      description:
        "Browse the meal planner history. Returns a calendar-style view of planned meals " +
        "grouped by date, showing what was cooked and when. Each day lists meals sorted by " +
        "type (Breakfast → Lunch → Dinner → custom types). Freeform meals (not linked to a " +
        "recipe) are annotated. " +
        "By default, returns the last 30 days of meal history. When a recipe_uid or type " +
        "filter is provided, searches all time instead. Use since/until for custom date " +
        "ranges. " +
        "Use this tool to answer questions like 'what did we eat last week', 'when did we " +
        "last have tacos', 'show me dinner plans for this month', or 'what's on the meal " +
        "planner'. For recipe details (ingredients, directions), use read_recipe instead.",
      inputSchema: {
        recipe_uid: RecipeUidSchema.optional().describe(
          "Filter to meals for a specific recipe UID. Searches all time when set.",
        ),
        since: z
          .string()
          .optional()
          .describe("Start date (inclusive). Accepts ISO 8601 or yyyy-MM-dd. Overrides the 30-day default."),
        until: z
          .string()
          .optional()
          .describe("End date (inclusive). Accepts ISO 8601 or yyyy-MM-dd. Overrides the 30-day default."),
        // Discriminated union: pick exactly one shape. Avoids the ambiguity of
        // a single overloaded string (e.g. a custom mealtype named "2").
        type: mealTypeSpecSchema
          .optional()
          .describe(
            "Meal type filter. Searches all time when set. Pick exactly one shape: " +
              '{"name": "Dinner"} | {"uid": "<mealtype UID>"} | {"builtin": 2}.',
          ),
        offset: z.number().int().nonnegative().optional().default(0).describe("Pagination offset (default: 0)"),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .default(50)
          .describe("Maximum meals to return (default: 50, max: 200)"),
      },
    },
    async (args) => {
      log.info({ tool: "list_meal_history", ...args }, "tool invoked");
      return mealStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          let typeUid: MealTypeUid | undefined;
          // Captured when the resolved typeUid belongs to a built-in mealtype
          // (non-null originalType). MealStore.getInDateRange uses it to also
          // surface legacy meals (typeUid: null, integer-only) matching the
          // built-in. Undefined for custom-type filters.
          let legacyTypeInteger: number | undefined;
          if (args.type !== undefined) {
            // Shared resolver (#141) — same dispatch the write tools use. Format
            // rich, actionable errors from the structured result (an unknown
            // {uid} now errors rather than silently filtering by the literal
            // uid, matching the {name}/{builtin} branches and the write side).
            const result = resolveMealTypeSpec(ctx, args.type);
            if (!result.ok) {
              if (result.reason === "unknown_uid") {
                return textResult(`Unknown meal type UID "${result.uid}".`);
              }
              if (result.reason === "unknown_name") {
                const knownList = result.knownNames.join(", ");
                return textResult(
                  `Unknown meal type "${result.name}". Known types: ${knownList}. ` +
                    `Use the {uid} or {builtin} discriminator to reference a custom meal type.`,
                );
              }
              return textResult(
                `No built-in meal type found with index ${result.index.toString()} ` +
                  `(expected 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks).`,
              );
            }
            typeUid = result.resolved.uid;
            // Built-in types carry a non-null originalType; surface legacy
            // (null-typeUid, integer-only) meals matching it. Custom types
            // (originalType: null) filter by typeUid alone.
            if (result.resolved.originalType !== null) {
              legacyTypeInteger = result.resolved.originalType;
            }
          }

          const hasFilter = args.recipe_uid !== undefined || typeUid !== undefined;
          let since: DateTime | undefined;
          let until: DateTime | undefined;

          if (args.since !== undefined) {
            const parsed = parseInstant(args.since);
            if (parsed === null) {
              return textResult(`Could not parse since date "${args.since}". Use yyyy-MM-dd or ISO 8601.`);
            }
            since = parsed.startOf("day");
          }

          if (args.until !== undefined) {
            const parsed = parseInstant(args.until);
            if (parsed === null) {
              return textResult(`Could not parse until date "${args.until}". Use yyyy-MM-dd or ISO 8601.`);
            }
            until = parsed.endOf("day");
          }

          if (since === undefined && until === undefined && !hasFilter) {
            until = DateTime.utc().endOf("day");
            since = until.minus({ days: 30 }).startOf("day");
          }

          const offset = args.offset ?? 0;
          const limit = args.limit ?? 50;

          const { meals, total } = ctx.mealStore.getInDateRange({
            since,
            until,
            recipeUid: args.recipe_uid,
            typeUid,
            legacyTypeInteger,
            offset,
            limit,
          });

          if (total === 0) {
            return textResult("No meals found matching the given filters.");
          }

          // Offset beyond the end of the result set — non-empty total but
          // empty page. Render a clear empty-page message instead of a
          // misleading "Showing 0 meals (<no range>)" header.
          if (meals.length === 0) {
            return textResult(
              `No meals at offset ${offset.toString()} of ${total.toString()} total. ` +
                `Try a lower offset (the last page starts at offset ${Math.max(0, total - limit).toString()}).`,
            );
          }

          const typeNames = new Map<string, string>();
          const typeByOriginalType = new Map<number, string>();
          for (const mt of ctx.mealTypeStore.getAll()) {
            typeNames.set(mt.uid, mt.name);
            // Only built-in types have a non-null originalType; custom types
            // can only be looked up by typeUid.
            if (mt.originalType !== null) {
              typeByOriginalType.set(mt.originalType, mt.name);
            }
          }

          const grouped = new Map<string, Array<{ typeName: string; entry: string }>>();
          for (const meal of meals) {
            const dateKey = meal.date.slice(0, 10);
            let entries = grouped.get(dateKey);
            if (entries === undefined) {
              entries = [];
              grouped.set(dateKey, entries);
            }
            entries.push(formatMealLine(meal, typeNames, typeByOriginalType));
          }

          const lines: Array<string> = [];

          const firstDate = meals.length > 0 ? meals[meals.length - 1]!.date.slice(0, 10) : "";
          const lastDate = meals.length > 0 ? meals[0]!.date.slice(0, 10) : "";
          const rangeLabel = firstDate === lastDate ? firstDate : `${firstDate} – ${lastDate}`;

          // Clean header only when no offset AND everything fits in one page;
          // otherwise show the full pagination context so the header always
          // reflects what's actually rendered.
          if (offset === 0 && total <= limit) {
            lines.push(`**Showing ${total.toString()} meals (${rangeLabel})**`);
          } else {
            const end = offset + meals.length;
            lines.push(
              `**Showing ${(offset + 1).toString()}–${end.toString()} of ${total.toString()} meals (${rangeLabel})**`,
            );
          }

          for (const [dateKey, entries] of grouped) {
            const dt = DateTime.fromISO(dateKey, { zone: "utc" });
            const dayLabel = dt.isValid ? dt.toFormat("EEE dd") : dateKey;
            lines.push("");
            lines.push(`### ${dayLabel}`);

            const byType = new Map<string, Array<string>>();
            for (const { typeName, entry } of entries) {
              let typeEntries = byType.get(typeName);
              if (typeEntries === undefined) {
                typeEntries = [];
                byType.set(typeName, typeEntries);
              }
              typeEntries.push(entry);
            }

            for (const [typeName, typeEntries] of byType) {
              lines.push(`- **${typeName}** · ${typeEntries.join(", ")}`);
            }
          }

          return textResult(lines.join("\n"));
        },
        (guard) => guard,
      );
    },
  );
}
