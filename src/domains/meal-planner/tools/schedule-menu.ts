import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealTypeUid } from "../../meal-type/ids.js";
import type { MealType } from "../../meal-type/types.js";
import type { Meal } from "../../meal/types.js";
import type { RecipeUid } from "../../recipe/ids.js";

import { defineTool } from "../../../kernel/tool.js";
import {
  errorResult,
  resolveLookup,
  resolveOrPick,
  structuredResult,
  toolResult,
  uidOrTextLookupSchema,
} from "../../../shared/tools.js";
import { formatCalendarDayWire, parseCalendarDay } from "../../../utils/dates.js";
import { MealUidSchema } from "../../meal/ids.js";
import { mealListOutputSchema } from "../../meal/tools/helpers.js";
import { MenuUidSchema } from "../../menu/ids.js";
import { scheduleMenuStartGuard } from "./guards.js";

/**
 * `schedule_menu` — the meal-planner COORDINATOR's only tool. Every cross-domain store
 * read/write is expressed through a DECLARED dependency's contract — `ctx.deps.recipe`,
 * `ctx.deps.menu`, `ctx.deps["meal-type"]`, `ctx.deps.meal`. The coordinator owns no
 * store of its own.
 *
 * Its three-leg readiness gate (recipe — re-resolve names; menu + meal-type —
 * resolve items and their types; meal — POST the batch) lives in
 * `scheduleMenuStartGuard` (tools/guards.ts), run as a precondition. Each
 * leg carries its own "not yet synced" message; `menu.hasSynced()` covers BOTH
 * menu-owned stores (menus + menu-items), with the meal-type check as the third leg.
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
    outputSchema: mealListOutputSchema,
  },
  [scheduleMenuStartGuard],
  (ctx: DomainCtx<Record<never, never>, "menu" | "meal" | "recipe" | "meal-type">) => {
    const log = ctx.infra.log.child({ component: "schedule_menu" });
    return async (args) => {
      // Resolve the menu (single): a miss / no-match returns prose and an
      // ambiguous name offers a disambiguation PICK, all before any Paprika write.
      const query = "uid" in args.menu ? { uid: args.menu.uid } : { text: args.menu.name };
      const outcome = resolveLookup(query, {
        get: (uid) => ctx.deps.menu.get(uid),
        findByText: (text) => ctx.deps.menu.findByName(text),
      });

      const resolved = await resolveOrPick(ctx.server.server, outcome, {
        entityNoun: "menu",
        describe: (m) => ({ uid: m.uid, label: m.name }),
        findWith: "list_menus",
        log,
      });
      if ("result" in resolved) return resolved.result;
      const menu = resolved.entity;

      const menuItems = ctx.deps.menu.itemsOf(menu.uid);
      if (menuItems.length === 0) {
        return errorResult(`Menu "${menu.name}" has no items to add to the planner.`);
      }

      // Parse the start date once; a bad date dooms the whole batch.
      const startDay = parseCalendarDay(args.start_date);
      if (startDay === null) {
        return errorResult(
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
        return errorResult(`${header}\n\n${errors.join("\n")}`);
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
      // sequence and distinguishes save failure (nothing created server-side → isError)
      // from commit failure (meals exist on Paprika → degraded success so the model can
      // chain reschedule_meal / delete_meal on the created UIDs without retrying the POST).
      const result = await ctx.deps.meal.createMeals(builtItems);
      return result.match(
        // The new meal UIDs ride structuredContent — schedule_menu's text omits them
        // entirely (it scales to a 21-meal week), so without this the model could not
        // chain reschedule_meal / update_meal / delete_meal on what it just created. The
        // rows are built through the meal contract so the meal-type catalog stays meal's.
        (savedMeals) => structuredResult({ items: [...ctx.deps.meal.toRows(savedMeals)] }),
        (error) => {
          log.error({ uid: menu.uid, count: builtItems.length, phase: error.phase }, "createMeals failed");
          if (error.phase === "save") {
            return errorResult(`Failed to add menu to planner: ${error.message}`);
          }
          // Commit phase: the meals DID land on Paprika — marking isError would invite a
          // harmful duplicate-write retry. Return a degraded success so the created UIDs
          // ride structuredContent; they will appear in the planner after the next sync.
          return toolResult(
            `${error.saved.length.toString()} meal(s) from "${menu.name}" were added to Paprika but the local ` +
              `cache commit failed: ${error.message}. The meals will appear in the planner after the next sync cycle.`,
            { items: [...ctx.deps.meal.toRows(error.saved)] },
          );
        },
      );
    };
  },
);
