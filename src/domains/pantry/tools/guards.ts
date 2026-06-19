import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { PantryState } from "../module.js";

import { errorResult } from "../../../shared/tools.js";

/**
 * Readiness gate: returns `ok` when the store has synced, `err` with a
 * user-facing `CallToolResult` otherwise. Runs as a kernel precondition.
 *
 * `errorResult` (`isError`): `list_pantry_items` declares an `outputSchema` (ADR-0019
 * R1), so a non-error gate result would be rejected by the SDK's output validation.
 */
export function pantryStartGuard({ state }: { readonly state: PantryState }): Result<void, CallToolResult> {
  if (!state.store.hasSynced) {
    return err(errorResult("Pantry is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
