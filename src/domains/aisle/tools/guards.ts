import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { AisleState } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Readiness gate: `ok` once the aisle catalog has synced, else `err` with a
 * user-facing `CallToolResult`. Consumed via `.match()` by `list_aisles`.
 */
export function aisleStartGuard(state: AisleState): Result<void, CallToolResult> {
  if (!state.store.hasSynced) {
    return err(textResult("Aisle list is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
