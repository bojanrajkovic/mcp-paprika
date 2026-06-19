import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryState } from "../module.js";

import { errorResult, toolResult } from "../../../shared/tools.js";

/**
 * Readiness gate: both the lists and items stores (both grocery-owned) must have
 * completed a first sync — `read_grocery_list` inlines items. Returns
 * `Result<void, CallToolResult>`, runs as a kernel precondition.
 *
 * Returns `errorResult` (`isError`): it guards `list_grocery_lists`, which declares
 * an `outputSchema` (ADR-0019 R1), so a non-error gate result would be rejected by
 * the SDK's output validation. The secondary `pantrySyncedGuard` / `recipeSyncedGuard`
 * guard no schema-bearing tool yet, so they stay plain `toolResult`s.
 */
export function groceryStartGuard({ state }: { readonly state: GroceryState }): Result<void, CallToolResult> {
  if (!state.lists.store.hasSynced || !state.items.store.hasSynced) {
    return err(errorResult("Grocery data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Secondary readiness gate for `move_grocery_items_to_pantry`: the pantry
 * dependency must also have completed a first sync before grocery items can be
 * moved into it. Runs as a kernel precondition, after
 * `groceryStartGuard`.
 */
export function pantrySyncedGuard(ctx: DomainCtx<GroceryState, "aisle" | "pantry">): Result<void, CallToolResult> {
  if (!ctx.deps.pantry.hasSynced()) {
    return err(toolResult("Pantry is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Secondary readiness gate for `add_recipe_to_grocery_list`: the recipe
 * dependency must have completed a first sync before a recipe can be resolved
 * by uid or title. Runs as a kernel precondition, after
 * `groceryStartGuard`.
 */
export function recipeSyncedGuard(
  ctx: DomainCtx<GroceryState, "aisle" | "pantry" | "recipe">,
): Result<void, CallToolResult> {
  if (!ctx.deps.recipe.hasSynced()) {
    return err(toolResult("Recipes are not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
