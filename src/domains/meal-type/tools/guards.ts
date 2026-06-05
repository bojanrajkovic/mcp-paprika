import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { MealTypeState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Readiness gate: `ok` once the meal-type catalog has synced, else `err` with a
 * user-facing `CallToolResult`. Consumed via `.match()` by `list_meal_types`.
 */
export function mealTypeStartGuard(state: MealTypeState): Result<void, CallToolResult> {
  if (!state.store.hasSynced) {
    return err(textResult("Meal types are not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
