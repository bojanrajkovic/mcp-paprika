import type { DomainCtx } from "../../../kernel/registry.js";
import type { GroceryState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { AisleUidSchema } from "../../aisle/ids.js";
import { groceryStartGuard, pantrySyncedGuard } from "./guards.js";

/**
 * `delete_aisle` — delete an aisle from the catalog, guarding on the items that
 * reference it. The tool lives in GROCERY (not aisle) because the guard needs the
 * referencing items: grocery owns grocery items and reaches pantry's count via
 * `ctx.deps.pantry`, while aisle is a dependency leaf that can see neither. The
 * catalog write itself goes through `ctx.deps.aisle.deleteAisle`.
 *
 * Guard semantics: UNPURCHASED grocery items and ALL pantry items block (both are
 * current, reassignable state — the remediation hint is executable). Purchased
 * grocery items don't block (they're shopping history; render-resolve falls back
 * to their denormalized aisle name). Ingredient-catalog aisle memory never blocks
 * and isn't scrubbed: the add flow already treats a dangling catalog ref as "no
 * memory" (see add_grocery_items' Miscellaneous placement), so a scrub would be
 * behaviorally invisible.
 */
export const deleteAisleTool = defineTool(
  {
    name: "delete_aisle",
    title: "Delete a grocery aisle",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Delete an aisle from the catalog. Refuses while unpurchased grocery items or pantry items still " +
      "reference it — reassign those first (`update_grocery_item` / `update_pantry_item` with a different " +
      "aisle). Deletion is permanent, but adding an item with the same aisle name recreates it.",
    inputSchema: {
      uid: AisleUidSchema.describe("UID of the aisle to delete (from list_aisles)"),
    },
  },
  [groceryStartGuard, pantrySyncedGuard],
  (ctx: DomainCtx<GroceryState, "aisle" | "pantry">) => {
    const log = ctx.infra.log.child({ component: "delete_aisle" });
    return async (args) => {
      const existing = ctx.deps.aisle.get(args.uid);
      if (existing === undefined) {
        return textResult(`No aisle found with UID "${args.uid}" (see list_aisles; the catalog may still be syncing).`);
      }

      const groceryRefs = ctx.state.items.store.countUnpurchasedInAisle(args.uid);
      const pantryRefs = ctx.deps.pantry.countItemsInAisle(args.uid);
      if (groceryRefs > 0 || pantryRefs > 0) {
        const parts: Array<string> = [];
        if (groceryRefs > 0) {
          parts.push(`${String(groceryRefs)} unpurchased grocery item${groceryRefs === 1 ? "" : "s"}`);
        }
        if (pantryRefs > 0) {
          parts.push(`${String(pantryRefs)} pantry item${pantryRefs === 1 ? "" : "s"}`);
        }
        return textResult(
          `Cannot delete "${existing.name}": ${parts.join(" and ")} still reference it. ` +
            "Reassign them to another aisle first (`update_grocery_item` / `update_pantry_item`), then retry.",
        );
      }

      return (await ctx.deps.aisle.deleteAisle(args.uid)).match(
        () => textResult(`Deleted aisle "${existing.name}".`),
        (message) => {
          log.error({ uid: args.uid, message }, "deleteAisle failed");
          return textResult(message);
        },
      );
    };
  },
);
