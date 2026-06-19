import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealState } from "../module.js";

import { errorResult } from "../../../shared/tools.js";

/**
 * Both stores must be synced. The mealtype store is required by the type resolver
 * (`deps["meal-type"].resolveSpec`, used by both the write and read tools); without
 * it, every "Dinner" / "Lunch" lookup returns undefined and the user sees "Unknown
 * meal type" errors that look like input mistakes but are actually a cold-cache
 * state. Guarding both up front turns that into a clear "still syncing" message.
 * Runs as a kernel precondition.
 *
 * The gate failure is an `errorResult` (`isError`), not a plain `toolResult`: the
 * read tools declare an `outputSchema` (ADR-0019), and the SDK's `validateToolOutput`
 * would otherwise reject a non-error gate result that carries no `structuredContent`,
 * replacing this message with a generic schema error. `isError` exempts it (the
 * contract is pinned in `src/kernel/tool.e2e.test.ts`).
 */
export function mealStartGuard(ctx: DomainCtx<MealState, "meal-type">): Result<void, CallToolResult> {
  if (!ctx.state.store.hasSynced || !ctx.deps["meal-type"].hasSynced()) {
    return err(errorResult("Meal data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
