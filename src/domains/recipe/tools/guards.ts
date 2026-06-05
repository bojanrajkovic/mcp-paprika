import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { RecipeState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Kernel-shaped readiness gates. Read this module's own stores via `self` —
 * domain-isolated, with no discover coupling. Same `Result<void, CallToolResult>`
 * shape, consumed via `.match()`.
 */
export function recipeColdStartGuard(self: RecipeState): Result<void, CallToolResult> {
  if (!self.recipe.store.hasSynced) {
    return err(textResult("Recipe store is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Every category tool's gate: recipe store synced (`list_categories` counts recipes
 * per category, `delete_category` scans recipes for references) AND the category
 * catalog synced. Within the recipe domain both stores are `self`.
 */
export function categoryStartGuard(self: RecipeState): Result<void, CallToolResult> {
  return recipeColdStartGuard(self).andThen(() =>
    self.category.store.hasSynced
      ? ok(undefined)
      : err(textResult("The category catalog is still syncing; try again in a moment.")),
  );
}
