import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { AisleState } from "../module.js";

import { errorResult } from "../../../shared/tools.js";

/**
 * Readiness gate: `ok` once the aisle catalog has synced, else `err` with a
 * user-facing `CallToolResult`. Runs as a kernel precondition.
 *
 * `errorResult` (`isError`): `list_aisles` declares an `outputSchema` (ADR-0019 R1),
 * so a non-error gate result would be rejected by the SDK's output validation.
 */
export function aisleStartGuard({ state }: { readonly state: AisleState }): Result<void, CallToolResult> {
  if (!state.store.hasSynced) {
    return err(errorResult("Aisle list is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
