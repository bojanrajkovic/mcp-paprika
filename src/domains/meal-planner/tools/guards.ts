import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { DomainCtx } from "../../../kernel/registry.js";

import { textResult } from "../../../shared/tools.js";

/**
 * `schedule_menu`'s three-leg readiness gate, in dependency order: recipe (display
 * names are re-resolved), menu + meal-type (items and their types resolved), then
 * meal (the batch is POSTed). The coordinator owns no store, so every leg is a
 * dependency's `hasSynced()`, and each carries its own message. Consumed via
 * `.match()`. `menu.hasSynced()` covers BOTH menu-owned stores (menus + menu-items);
 * the meal-type check is the third leg of that gate.
 */
export function scheduleMenuStartGuard(
  ctx: DomainCtx<Record<never, never>, "menu" | "meal" | "recipe" | "meal-type">,
): Result<void, CallToolResult> {
  if (!ctx.deps.recipe.hasSynced()) {
    return err(textResult("Recipe store is not yet synced. Try again in a few seconds."));
  }
  if (!ctx.deps.menu.hasSynced() || !ctx.deps["meal-type"].hasSynced()) {
    return err(textResult("Menu data is not yet synced. Try again in a few seconds."));
  }
  if (!ctx.deps.meal.hasSynced()) {
    return err(textResult("Meal planner is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * `delete_meal_type`'s readiness gate: the meal-type catalog (the entity being
 * deleted) plus meal and menu (the reference counts the warning reports). No
 * recipe leg — recipe data plays no part in the delete.
 */
export function deleteMealTypeStartGuard(
  ctx: DomainCtx<Record<never, never>, "menu" | "meal" | "recipe" | "meal-type">,
): Result<void, CallToolResult> {
  if (!ctx.deps["meal-type"].hasSynced()) {
    return err(textResult("Meal types are not yet synced. Try again in a few seconds."));
  }
  if (!ctx.deps.meal.hasSynced() || !ctx.deps.menu.hasSynced()) {
    return err(textResult("Meal and menu data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
