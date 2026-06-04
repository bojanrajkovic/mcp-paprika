import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { RecipeSelf } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Kernel-shaped readiness gates. The legacy `coldStartGuard`/`categoryStartGuard`
 * (`src/tools/{helpers,category-helpers}.ts`) take the god-object `ServerContext`
 * and `categoryStartGuard` pulls in the discover feature; both are re-bound here to
 * read this module's own stores via `self`, dropping the discover coupling. Same
 * `Result<void, CallToolResult>` shape, consumed via `.match()`.
 */
export function recipeColdStartGuard(self: RecipeSelf): Result<void, CallToolResult> {
  if (!self.recipe.store.hasSynced) {
    return err(textResult("Recipe store is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}

/**
 * Every category tool's gate: recipe store synced (`list_categories` counts recipes
 * per category, `delete_category` scans recipes for references) AND the category
 * catalog synced. Within the collapsed recipe domain both stores are `self`.
 */
export function categoryStartGuard(self: RecipeSelf): Result<void, CallToolResult> {
  return recipeColdStartGuard(self).andThen(() =>
    self.category.store.hasSynced
      ? ok(undefined)
      : err(textResult("The category catalog is still syncing; try again in a moment.")),
  );
}
