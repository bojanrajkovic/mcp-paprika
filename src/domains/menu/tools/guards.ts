import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { err, ok, type Result } from "neverthrow";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuSelf } from "../module.js";

import { textResult } from "../../../shared/tools.js";

/**
 * Kernel-shaped readiness gate. The legacy `menuStartGuard`
 * (`src/tools/menu-helpers.ts:23`) takes the god-object `ServerContext` and reads
 * `menuStore.hasSynced`, `menuItemStore.hasSynced`, AND `mealTypeStore.hasSynced`.
 * Re-bound here: the first two are `self` (menu + menu-items), the third is the
 * meal-type dependency's readiness signal (`deps["meal-type"].hasSynced()`).
 *
 * `mealTypeStore` is required because `read_menu`, the menu write tools, and the
 * `paprika://menu/{uid}` resource render each item's meal-type name and sort within
 * a day by the type's order; meal-type sync is best-effort and can lag independently,
 * so without this check a cold meal-type catalog renders every item with an opaque
 * `typeUid` sorted as unknown. Same `Result<void, CallToolResult>` shape, consumed
 * via `.match()`.
 */
export function menuStartGuard(ctx: DomainCtx<MenuSelf, "recipe" | "meal-type">): Result<void, CallToolResult> {
  if (!ctx.self.menus.store.hasSynced || !ctx.self.items.store.hasSynced || !ctx.deps["meal-type"].hasSynced()) {
    return err(textResult("Menu data is not yet synced. Try again in a few seconds."));
  }
  return ok(undefined);
}
