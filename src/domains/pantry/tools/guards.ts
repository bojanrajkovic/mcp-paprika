import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { PantryState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Readiness gate: returns `ok` when the store has synced, `err` with a
 * user-facing `CallToolResult` otherwise. Runs as a kernel precondition.
 */
export function pantryStartGuard({ state }: { readonly state: PantryState }): Result<void, CallToolResult> {
  if (!state.store.hasSynced) {
    return err(textResult("Pantry is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
