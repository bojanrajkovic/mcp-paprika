import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { MealTypeState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Readiness gate: `ok` once the meal-type catalog has synced, else `err` with a
 * user-facing `CallToolResult`. Runs as a kernel precondition.
 */
export function mealTypeStartGuard({ state }: { readonly state: MealTypeState }): Result<void, CallToolResult> {
  if (!state.store.hasSynced) {
    return err(textResult("Meal types are not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
