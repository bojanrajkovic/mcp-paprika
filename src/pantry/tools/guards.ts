import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { PantrySelf } from "../module.js";

import { textResult } from "../../tools/helpers.js";

/**
 * Kernel-shaped readiness gate. The legacy `pantryStartGuard`
 * (`src/tools/pantry-helpers.ts`) takes the god-object `ServerContext`; this
 * re-binds it to read this module's own store via `self`. Same
 * `Result<void, CallToolResult>` shape, consumed via `.match()`.
 */
export function pantryStartGuard(self: PantrySelf): Result<void, CallToolResult> {
  if (!self.store.hasSynced) {
    return err(textResult("Pantry is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
