import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DateTime } from "luxon";
import { z } from "zod";
import { err, ok, type Result } from "neverthrow";
import { textResult } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";
import type { Meal } from "../paprika/types.js";

function mealStartGuard(ctx: ServerContext): Result<void, ReturnType<typeof textResult>> {
  if (!ctx.mealStore.hasSynced) {
    return err(textResult("Meal history is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

function parseInputDate(input: string): DateTime | null {
  for (const fmt of ["yyyy-MM-dd HH:mm:ss", "yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd"]) {
    const dt = DateTime.fromFormat(input, fmt, { zone: "utc" });
    if (dt.isValid) return dt;
  }
  const iso = DateTime.fromISO(input, { zone: "utc" });
  if (iso.isValid) return iso;
  return null;
}

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
        recipe_uid: z
          .string()
          .optional()
          .describe("Filter to meals for a specific recipe UID. Searches all time when set."),
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
        type: z
          .union([
            z.object({ name: z.string() }).describe('Resolve by name, e.g. {"name": "Dinner"}.'),
            z.object({ uid: z.string() }).describe('Use a mealtype UID directly, e.g. {"uid": "216713D08860..."}.'),
            z
              .object({ builtin: z.number().int().min(0).max(3) })
              .describe('Pick a built-in: 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks. e.g. {"builtin": 2}.'),
          ])
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
          let typeUid: string | undefined;
          // Captured when the resolved typeUid belongs to a built-in mealtype
          // (non-null originalType). MealStore.getInDateRange uses it to also
          // surface legacy meals (typeUid: null, integer-only) matching the
          // built-in. Undefined for custom-type filters.
          let legacyTypeInteger: number | undefined;
          if (args.type !== undefined) {
            if ("uid" in args.type) {
              const wantedUid = args.type.uid;
              typeUid = wantedUid;
              const mt = ctx.mealTypeStore.getAll().find((m) => m.uid === wantedUid);
              if (mt?.originalType !== undefined && mt.originalType !== null) {
                legacyTypeInteger = mt.originalType;
              }
            } else if ("name" in args.type) {
              const mt = ctx.mealTypeStore.resolveByName(args.type.name);
              if (mt === undefined) {
                return textResult(
                  `Unknown meal type "${args.type.name}". Use list_meal_history without a type filter to see available meal types in context.`,
                );
              }
              typeUid = mt.uid;
              if (mt.originalType !== null) {
                legacyTypeInteger = mt.originalType;
              }
            } else {
              const builtinInt = args.type.builtin;
              for (const mt of ctx.mealTypeStore.getAll()) {
                if (mt.originalType === builtinInt) {
                  typeUid = mt.uid;
                  legacyTypeInteger = builtinInt;
                  break;
                }
              }
              if (typeUid === undefined) {
                return textResult(
                  `No built-in meal type found with index ${builtinInt.toString()} (expected 0=Breakfast, 1=Lunch, 2=Dinner, 3=Snacks).`,
                );
              }
            }
          }

          const hasFilter = args.recipe_uid !== undefined || typeUid !== undefined;
          let since: DateTime | undefined;
          let until: DateTime | undefined;

          if (args.since !== undefined) {
            const parsed = parseInputDate(args.since);
            if (parsed === null) {
              return textResult(`Could not parse since date "${args.since}". Use yyyy-MM-dd or ISO 8601.`);
            }
            since = parsed.startOf("day");
          }

          if (args.until !== undefined) {
            const parsed = parseInputDate(args.until);
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

          if (total <= limit) {
            lines.push(`**Showing ${total.toString()} meals (${rangeLabel})**`);
          } else {
            const end = Math.min(offset + limit, total);
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
