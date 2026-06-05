import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { DateTime } from "luxon";
import { z } from "zod";

import type { MealTypeUid, RecipeUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealType } from "../../meal-type/types.js";
import type { Meal } from "../../meal/types.js";

import { MealUidSchema, MenuUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { resolveLookup, textResult, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { formatCalendarDayWire, parseCalendarDay } from "../../../utils/dates.js";

/**
 * `schedule_menu` — the meal-planner COORDINATOR's only tool. Every cross-domain store
 * read/write is expressed through a DECLARED dependency's contract — `ctx.deps.recipe`,
 * `ctx.deps.menu`, `ctx.deps["meal-type"]`, `ctx.deps.meal`. The coordinator owns no
 * store, so it can never reach a dep's store/cache directly.
 *
 * Three readiness gates are composed inline as plain boolean checks: recipe
 * (re-resolve names), menu + meal-type (resolve items and their types), and meal
 * (POST the batch). Each guard produces the same user-facing "not yet synced"
 * message appropriate to its domain. `menu.hasSynced()` covers BOTH menu-owned
 * stores (menus + menu-items); the meal-type check is the third leg of that gate.
 */

// A menu item materialized into a planner meal: the menu's 1-indexed `day`, the
// computed wire `date`, the resolved meal-type name (for the response) + its
// wire `typeUid`/`type` integer, the display `name`, and the recipe link.
type MaterializedMeal = {
  readonly day: number;
  readonly date: string;
  readonly typeName: string;
  readonly typeUid: MealTypeUid;
  readonly type: number;
  readonly name: string;
  readonly recipeUid: RecipeUid | null;
};

export const scheduleMenuInputSchema = z.object({
  menu: uidOrTextLookupSchema({
    uidSchema: MenuUidSchema,
    textKey: "name",
    entityLabel: "menu",
    textExample: "Whole30 week 2",
  }),
  start_date: z
    .string()
    .min(1)
    .describe(
      "Calendar day for the menu's day-1 items (ISO 8601 / yyyy-MM-dd; time-of-day dropped). " +
        "Day-N items land on start_date + (N−1) days.",
    ),
});

/**
 * Renders the compact, day-grouped success response. No per-meal UIDs — scales
 * to a 21-meal week; an agent that needs a meal UID afterward calls
 * `read_meal_plan` or `search_meal_history`. `items` arrives pre-sorted in menu-layout order (day →
 * meal-type order → menu item order — the same order the `order_flag`s were
 * assigned in), so grouping by day preserves that order and the rendered
 * sequence matches the persisted planner sequence.
 */
function renderPlannerAdds(menuName: string, startDay: DateTime, items: ReadonlyArray<MaterializedMeal>): string {
  const lines: Array<string> = [
    `Added ${items.length.toString()} meal(s) to the planner from "${menuName}" ` +
      `(Day 1 = ${startDay.toFormat("yyyy-MM-dd")}).`,
  ];

  // Group preserving input order; days emit ascending (== materialized order,
  // but sort the keys defensively so a malformed clamped day can't reorder).
  const byDay = new Map<number, Array<MaterializedMeal>>();
  for (const item of items) {
    const bucket = byDay.get(item.day);
    if (bucket === undefined) byDay.set(item.day, [item]);
    else bucket.push(item);
  }

  for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
    const dayItems = byDay.get(day)!;
    lines.push("");
    lines.push(`## ${dayItems[0]!.date.slice(0, 10)} (Day ${day.toString()})`);
    lines.push("");
    for (const item of dayItems) {
      lines.push(`- **${item.typeName}:** ${item.name}`);
    }
  }

  return lines.join("\n");
}

export const scheduleMenuTool = defineTool(
  {
    name: "schedule_menu",
    title: "Add a saved menu's recipes to the meal planner",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    description:
      "Instantiate a saved menu's recipes as meal-planner entries. Look the menu up by UID or name " +
      "(tiered fuzzy match), then materialize each of its items into a meal dated start_date + (day − 1) " +
      "days, posting them all in one batch. This is a one-way COPY, not a link: the planner meals carry no " +
      "back-reference to the menu, so editing the menu later does not change them — and it is NOT idempotent, " +
      "so re-running adds a second copy (same as Paprika.app's own Add Menu action). Recipe display names " +
      "re-resolve from the local recipe store; if ANY recipe-linked item references an unknown recipe the " +
      "whole batch is rejected with a per-item enumeration (freeform items keep their stored name). To remove " +
      "a meal afterward, find it via read_meal_plan or search_meal_history and call delete_meal.",
    inputSchema: scheduleMenuInputSchema.shape,
  },
  (ctx: DomainCtx<Record<never, never>, "menu" | "meal" | "recipe" | "meal-type">) => {
    const log = ctx.infra.log.child({ component: "schedule_menu" });
    return async (args) => {
      log.info({ tool: "schedule_menu", ...args.menu }, "tool invoked");
      // Three readiness gates: recipe (we re-resolve display names), menu + meal-type
      // (resolve items and their types), then meal (we POST the batch).
      if (!ctx.deps.recipe.hasSynced()) {
        return textResult("Recipe store is not yet synced. Try again in a few seconds.");
      }
      // menu.hasSynced() covers BOTH menu-owned stores (menus + menu-items); the
      // meal-type check is the third leg of this gate.
      if (!ctx.deps.menu.hasSynced() || !ctx.deps["meal-type"].hasSynced()) {
        return textResult("Menu data is not yet synced. Try again in a few seconds.");
      }
      if (!ctx.deps.meal.hasSynced()) {
        return textResult("Meal planner is not yet synced. Try again in a few seconds.");
      }

      // Resolve the menu (single). Misses/ambiguity short-circuit with the
      // standard lookup wording, no network touched.
      const query = "uid" in args.menu ? { uid: args.menu.uid } : { text: args.menu.name };
      const outcome = resolveLookup(query, {
        get: (uid) => ctx.deps.menu.get(uid),
        findByText: (text) => ctx.deps.menu.findByName(text),
      });

      if (outcome.kind === "uid_miss") {
        return textResult(`No menu found with UID "${outcome.uid}" (it may not exist or was already deleted).`);
      }
      if (outcome.kind === "text_none") {
        return textResult(`No menus found matching "${outcome.text}".`);
      }
      if (outcome.kind === "text_many") {
        const list = outcome.matches.map((menu) => `- **${menu.name}** (uid: \`${menu.uid}\`)`).join("\n");
        return textResult(`Multiple menus match "${outcome.text}":\n${list}\n\nPlease re-invoke with a specific uid.`);
      }

      const menu = outcome.entity;

      const menuItems = ctx.deps.menu.itemsOf(menu.uid);
      if (menuItems.length === 0) {
        return textResult(`Menu "${menu.name}" has no items to add to the planner.`);
      }

      // Parse the start date once; a bad date dooms the whole batch.
      const startDay = parseCalendarDay(args.start_date);
      if (startDay === null) {
        return textResult(
          `Could not parse start_date "${args.start_date}". ` +
            `Use ISO 8601 (e.g., "2026-06-15") or "yyyy-MM-dd HH:mm:ss".`,
        );
      }

      const typeByUid = new Map<string, MealType>();
      for (const mt of ctx.deps["meal-type"].getAll()) typeByUid.set(mt.uid, mt);

      // Materialize in the menu's intended layout order: day, then meal-type
      // order, then the item's own order_flag. `order_flag` is assigned in this
      // order below, so the planner sequence within a date mirrors the menu —
      // and matches the wire capture, where same-date items sequence by meal
      // type (Breakfast 0, Lunch 1). getByMenuUid returns arbitrary store-insertion
      // order, so without this sort the persisted flags would be nondeterministic.
      const UNKNOWN_TYPE_ORDER = Number.MAX_SAFE_INTEGER;
      const orderedItems = [...menuItems].sort((a, b) => {
        if (a.day !== b.day) return a.day - b.day;
        const orderA = typeByUid.get(a.typeUid)?.orderFlag ?? UNKNOWN_TYPE_ORDER;
        const orderB = typeByUid.get(b.typeUid)?.orderFlag ?? UNKNOWN_TYPE_ORDER;
        if (orderA !== orderB) return orderA - orderB;
        return a.orderFlag - b.orderFlag;
      });

      // ----- Validation pass (collect ALL errors, reject the batch if any) -----
      const errors: Array<string> = [];
      const materialized: Array<MaterializedMeal> = [];

      for (let i = 0; i < orderedItems.length; i++) {
        const item = orderedItems[i]!;

        // Re-resolve the display name from the recipe store (don't trust the
        // menu item's denormalized name). Recipe-linked items with an unknown
        // recipe reject the whole batch — strict, like plan_meals / add_menu_items.
        // Freeform items (recipeUid: null) materialize from their stored name.
        let name: string;
        if (item.recipeUid !== null) {
          const recipe = ctx.deps.recipe.get(item.recipeUid);
          if (recipe === undefined) {
            errors.push(
              `Item ${i.toString()}: recipe_uid "${item.recipeUid}" is not known to the local recipe store; ` +
                `wait for the next sync and retry.`,
            );
            continue;
          }
          name = recipe.name;
        } else {
          name = item.name;
        }

        // Resolve the meal type for the wire integer + display name. A missing
        // or custom type is fine: `type` is vestigial when `typeUid` is set
        // (Paprika dispatches off type_uid), so fall back to integer 0 and keep
        // the typeUid unchanged.
        const mt = typeByUid.get(item.typeUid);
        const type = mt?.originalType ?? 0;
        const typeName = mt?.name ?? item.typeUid;

        // date = start + (day − 1) days. Clamp guards the day: 0 the schema
        // technically permits (MenuItemStoredSchema.day is nonnegative).
        const offset = Math.max(0, item.day - 1);
        materialized.push({
          day: item.day,
          date: formatCalendarDayWire(startDay.plus({ days: offset })),
          typeName,
          typeUid: item.typeUid,
          type,
          name,
          recipeUid: item.recipeUid,
        });
      }

      if (errors.length > 0) {
        const header =
          errors.length === 1
            ? "Could not add menu to planner:"
            : `Could not add menu to planner (${errors.length.toString()} problems):`;
        return textResult(`${header}\n\n${errors.join("\n")}`);
      }

      // ----- Build meals with per-date order_flag, then POST once -----
      const assignFlag = ctx.deps.meal.orderFlagAssigner();
      const builtItems: Array<Meal> = materialized.map((m) => ({
        uid: MealUidSchema.parse(crypto.randomUUID().toUpperCase()),
        recipeUid: m.recipeUid,
        name: m.name,
        date: m.date,
        type: m.type,
        typeUid: m.typeUid,
        orderFlag: assignFlag(m.date),
        isIngredient: false,
        scale: null,
        deleted: false,
      }));

      // The meal contract internalizes the live `client.saveMeals` + `commitMealsBatch`
      // sequence and returns a Result; a write failure carries the same toMessage-style
      // text the live tool rendered. The coordinator never touches the meal store/cache.
      const result = await ctx.deps.meal.createMeals(builtItems);
      return result.match(
        (): CallToolResult => textResult(renderPlannerAdds(menu.name, startDay, materialized)),
        (message): CallToolResult => {
          log.error({ uid: menu.uid, count: builtItems.length }, "saveMeals failed");
          return textResult(`Failed to add menu to planner: ${message}`);
        },
      );
    };
  },
);
