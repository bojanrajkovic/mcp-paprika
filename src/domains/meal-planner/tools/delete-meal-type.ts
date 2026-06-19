import type { DomainCtx } from "../../../kernel/registry.js";

import { defineTool } from "../../../kernel/tool.js";
import { toolResult } from "../../../shared/tools.js";
import { MealTypeUidSchema } from "../../meal-type/ids.js";
import { deleteMealTypeStartGuard } from "./guards.js";

/**
 * `delete_meal_type` — delete a CUSTOM meal type, warning (not blocking) about
 * the meals and menu items that reference it. The tool lives in the MEAL-PLANNER
 * coordinator because the reference counts need meal + menu, and meal-type is a
 * dependency leaf that can see neither; the catalog write goes through
 * `ctx.deps["meal-type"].deleteMealType`.
 *
 * Warn-and-proceed, not a guard: meal references are append-only history (every
 * meal ever cooked under a type references it forever), so blocking would make a
 * type ever used in a logged meal permanently undeletable. The renderers omit a
 * dangling `typeUid`, so deletion degrades to "no meal type shown."
 *
 * BUILT-INS refuse deletion: `{builtin: N}` specs (and `log_cooked_meal`'s
 * Dinner default) resolve by `originalType`, and auto-create can only ever mint
 * a CUSTOM type (`originalType: null`) — so a deleted built-in would break
 * builtin-spec resolution permanently, with no recovery path. Built-ins can be
 * renamed/recolored/reordered instead (`update_meal_type` leaves `originalType`
 * intact).
 */
export const deleteMealTypeTool = defineTool(
  {
    name: "delete_meal_type",
    title: "Delete a meal type",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Delete a custom meal type from the catalog. Existing meals and menu items that reference it are kept " +
      "and simply show no meal type afterwards (the response reports how many). Planning a meal with the same " +
      "type name later recreates it. Built-in types (Breakfast/Lunch/Dinner/Snacks) cannot be deleted — " +
      "rename them with `update_meal_type` instead.",
    inputSchema: {
      uid: MealTypeUidSchema.describe("UID of the meal type to delete (from list_meal_types)"),
    },
  },
  [deleteMealTypeStartGuard],
  (ctx: DomainCtx<Record<never, never>, "menu" | "meal" | "recipe" | "meal-type">) => {
    const log = ctx.infra.log.child({ component: "delete_meal_type" });
    return async (args) => {
      const existing = ctx.deps["meal-type"].get(args.uid);
      if (existing === undefined) {
        return toolResult(`No meal type found with UID "${args.uid}" (see list_meal_types for the catalog).`);
      }

      if (existing.originalType !== null) {
        return toolResult(
          `Cannot delete "${existing.name}": it is a built-in meal type, and meal planning resolves built-ins ` +
            "by an identity a re-created custom type cannot restore. Rename, recolor, or reorder it with " +
            "`update_meal_type` instead.",
        );
      }

      const mealRefs = ctx.deps.meal.countByTypeUid(args.uid);
      const menuItemRefs = ctx.deps.menu.itemCountByTypeUid(args.uid);

      return (await ctx.deps["meal-type"].deleteMealType(args.uid)).match(
        () => {
          const parts: Array<string> = [];
          if (mealRefs > 0) parts.push(`${String(mealRefs)} meal${mealRefs === 1 ? "" : "s"}`);
          if (menuItemRefs > 0) parts.push(`${String(menuItemRefs)} menu item${menuItemRefs === 1 ? "" : "s"}`);
          const impact =
            parts.length > 0 ? ` ${parts.join(" and ")} referenced it and will show no meal type from now on.` : "";
          return toolResult(`Deleted meal type "${existing.name}".${impact}`);
        },
        (message) => {
          log.error({ uid: args.uid, message }, "deleteMealType failed");
          return toolResult(message);
        },
      );
    };
  },
);
