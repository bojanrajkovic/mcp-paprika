import type { DomainCtx } from "../../../kernel/registry.js";

import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { MealTypeUidSchema } from "../../meal-type/ids.js";
import { deleteMealTypeStartGuard } from "./guards.js";

/**
 * `delete_meal_type` — delete a meal type, warning (not blocking) about the meals
 * and menu items that reference it. The tool lives in the MEAL-PLANNER coordinator
 * because the reference counts need meal + menu, and meal-type is a dependency
 * leaf that can see neither; the catalog write goes through
 * `ctx.deps["meal-type"].deleteMealType`.
 *
 * Warn-and-proceed, not a guard: meal references are append-only history (every
 * meal ever cooked under "Dinner" references it forever), so blocking would make a
 * type ever used in a logged meal permanently undeletable. The renderers already
 * skip dangling `typeUid`s, so deletion degrades to "no meal type shown."
 * Built-ins are deletable too — auto-create resurrects the name on next reference
 * (as a custom type), so an accidental delete is recoverable.
 */
export const deleteMealTypeTool = defineTool(
  {
    name: "delete_meal_type",
    title: "Delete a meal type",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Delete a meal type from the catalog. Existing meals and menu items that reference it are kept and " +
      "simply show no meal type afterwards (the response reports how many). Planning a meal with the same " +
      "type name later recreates it.",
    inputSchema: {
      uid: MealTypeUidSchema.describe("UID of the meal type to delete (from list_meal_types)"),
    },
  },
  [deleteMealTypeStartGuard],
  (ctx: DomainCtx<Record<never, never>, "menu" | "meal" | "recipe" | "meal-type">) => {
    const log = ctx.infra.log.child({ component: "delete_meal_type" });
    return async (args) => {
      const existing = ctx.deps["meal-type"].getAll().find((mt) => mt.uid === args.uid);
      if (existing === undefined) {
        return textResult(`No meal type found with UID "${args.uid}" (see list_meal_types for the catalog).`);
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
          return textResult(`Deleted meal type "${existing.name}".${impact}`);
        },
        (message) => {
          log.error({ uid: args.uid, message }, "deleteMealType failed");
          return textResult(message);
        },
      );
    };
  },
);
