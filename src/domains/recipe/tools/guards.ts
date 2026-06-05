import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { RecipeState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Recipe readiness gates — a tool aborts early with a "still syncing" result if its
 * store hasn't completed a first sync. Return `Result<void, CallToolResult>`,
 * consumed via `.match()`.
 */
export function recipeColdStartGuard(state: RecipeState): Result<void, CallToolResult> {
  if (!state.recipe.store.hasSynced) {
    return err(textResult("Recipe store is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Every category tool's gate: recipe store synced (`list_categories` counts recipes
 * per category, `delete_category` scans recipes for references) AND the category
 * catalog synced.
 */
export function categoryStartGuard(state: RecipeState): Result<void, CallToolResult> {
  return recipeColdStartGuard(state).andThen(() =>
    state.category.store.hasSynced
      ? ok(undefined)
      : err(textResult("The category catalog is still syncing; try again in a moment.")),
  );
}
