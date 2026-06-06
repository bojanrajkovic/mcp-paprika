import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Readiness gate: all three stores (menus, menu-items, meal-types) must have
 * completed their first sync before any menu tool runs.
 *
 * The kernel ctx carries no cross-store access, so each store is checked as a
 * plain boolean: the two owned stores via `ctx.state`, and the meal-type catalog
 * via `ctx.deps["meal-type"].hasSynced()`. Meal-type sync is checked separately
 * because it is additive and can lag independently — a cold catalog would render
 * every item with an opaque `typeUid` sorted as unknown. Returns
 * `Result<void, CallToolResult>`, run as a kernel precondition (ADR-0015).
 */
export function menuStartGuard(ctx: DomainCtx<MenuState, "recipe" | "meal-type">): Result<void, CallToolResult> {
  if (!ctx.state.menus.store.hasSynced || !ctx.state.items.store.hasSynced || !ctx.deps["meal-type"].hasSynced()) {
    return err(textResult("Menu data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
