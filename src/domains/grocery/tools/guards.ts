import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { GrocerySelf } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Kernel-shaped readiness gate. Checks `lists.store.hasSynced` AND
 * `items.store.hasSynced` via `self` (both live in the same domain). Both
 * stores must be synced because `read_grocery_list` inlines items. Returns
 * `Result<void, CallToolResult>`, consumed via `.match()`.
 */
export function groceryStartGuard(self: GrocerySelf): Result<void, CallToolResult> {
  if (!self.lists.store.hasSynced || !self.items.store.hasSynced) {
    return err(textResult("Grocery data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
