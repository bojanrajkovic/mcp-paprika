import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Both stores must be synced. The mealtype store is required by the type resolver
 * (`deps["meal-type"].resolveSpec`, used by both the write and read tools); without
 * it, every "Dinner" / "Lunch" lookup returns undefined and the user sees "Unknown
 * meal type" errors that look like input mistakes but are actually a cold-cache
 * state. Guarding both up front turns that into a clear "still syncing" message.
 * Runs as a kernel precondition (ADR-0015).
 */
export function mealStartGuard(ctx: DomainCtx<MealState, "meal-type">): Result<void, CallToolResult> {
  if (!ctx.state.store.hasSynced || !ctx.deps["meal-type"].hasSynced()) {
    return err(textResult("Meal data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
