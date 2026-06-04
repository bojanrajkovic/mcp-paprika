import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { GrocerySelf } from "../module.js";

import { textResult } from "../../tools/helpers.js";

/**
 * Kernel-shaped readiness gate. The legacy `groceryStartGuard`
 * (`src/tools/grocery-helpers.ts:14`) takes the god-object `ServerContext` and reads
 * `groceryListStore.hasSynced` AND `groceryItemStore.hasSynced`; re-bound here, both
 * are `self` (lists + items live in the same collapsed domain). Both stores must be
 * synced because `read_grocery_list` inlines items. Same `Result<void, CallToolResult>`
 * shape, consumed via `.match()`.
 */
export function groceryStartGuard(self: GrocerySelf): Result<void, CallToolResult> {
  if (!self.lists.store.hasSynced || !self.items.store.hasSynced) {
    return err(textResult("Grocery data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
