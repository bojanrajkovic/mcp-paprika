import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { RecipeState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Recipe readiness gates — a tool aborts early with a "still syncing" result if its
 * store hasn't completed a first sync. Return `Result<void, CallToolResult>`, run as
 * kernel preconditions (ADR-0015).
 */
export function recipeColdStartGuard({ state }: { readonly state: RecipeState }): Result<void, CallToolResult> {
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
export function categoryStartGuard({ state }: { readonly state: RecipeState }): Result<void, CallToolResult> {
  return recipeColdStartGuard({ state }).andThen(() =>
    state.category.store.hasSynced
      ? ok(undefined)
      : err(textResult("The category catalog is still syncing; try again in a moment.")),
  );
}

/**
 * The photo tools' second leg: the photo catalog must have synced. Photo `order_flag`
 * and `name` are derived from the existing gallery, so uploading before photos sync
 * could assign a colliding index; a delete before the first photo sync would read a
 * not-yet-synced photo as "not found". Runs after the recipe cold-start gate (ADR-0015).
 */
export function photoCatalogGuard({ state }: { readonly state: RecipeState }): Result<void, CallToolResult> {
  if (!state.photo.store.hasSynced) {
    return err(textResult("The photo catalog is still syncing; try again in a moment."));
  }
  return ok(undefined);
}
