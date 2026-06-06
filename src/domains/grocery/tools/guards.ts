import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Readiness gate: both the lists and items stores (both grocery-owned) must have
 * completed a first sync — `read_grocery_list` inlines items. Returns
 * `Result<void, CallToolResult>`, runs as a kernel precondition (ADR-0015).
 */
export function groceryStartGuard({ state }: { readonly state: GroceryState }): Result<void, CallToolResult> {
  if (!state.lists.store.hasSynced || !state.items.store.hasSynced) {
    return err(textResult("Grocery data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Secondary readiness gate for `move_grocery_items_to_pantry`: the pantry
 * dependency must also have completed a first sync before grocery items can be
 * moved into it. Runs as a kernel precondition (ADR-0015), after
 * `groceryStartGuard`.
 */
export function pantrySyncedGuard(ctx: DomainCtx<GroceryState, "aisle" | "pantry">): Result<void, CallToolResult> {
  if (!ctx.deps.pantry.hasSynced()) {
    return err(textResult("Pantry is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Secondary readiness gate for `add_recipe_to_grocery_list`: the recipe
 * dependency must have completed a first sync before a recipe can be resolved
 * by uid or title. Runs as a kernel precondition (ADR-0015), after
 * `groceryStartGuard`.
 */
export function recipeSyncedGuard(
  ctx: DomainCtx<GroceryState, "aisle" | "pantry" | "recipe">,
): Result<void, CallToolResult> {
  if (!ctx.deps.recipe.hasSynced()) {
    return err(textResult("Recipes are not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
