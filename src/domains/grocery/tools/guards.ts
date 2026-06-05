import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { GroceryState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Readiness gate: both the lists and items stores (both grocery-owned) must have
 * completed a first sync — `read_grocery_list` inlines items. Returns
 * `Result<void, CallToolResult>`, consumed via `.match()`.
 */
export function groceryStartGuard(state: GroceryState): Result<void, CallToolResult> {
  if (!state.lists.store.hasSynced || !state.items.store.hasSynced) {
    return err(textResult("Grocery data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
