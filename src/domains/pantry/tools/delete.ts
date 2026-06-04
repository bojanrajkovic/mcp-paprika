import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantrySelf } from "../module.js";

import { PantryItemUidSchema } from "../../../ids.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { pantryStartGuard } from "./guards.js";

/**
 * Registers `delete_pantry_item`, kernel-shaped — soft-delete tombstone, writing
 * through `ctx.self.commitPantryItem`.
 */
export function deletePantryItemTool(ctx: DomainCtx<PantrySelf, "aisle">): void {
  const log = ctx.infra.log.child({ component: "delete_pantry_item" });
  ctx.server.registerTool(
    "delete_pantry_item",
    {
      title: "Delete a pantry item",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      description:
        "Soft-delete a pantry item by UID. Idempotent: a second delete on the same UID " +
        "returns a friendly 'already deleted' message without re-saving. Requires an exact UID.",
      inputSchema: {
        uid: PantryItemUidSchema.describe("Pantry item UID to delete"),
      },
    },
    async (args) => {
      log.info({ tool: "delete_pantry_item", uid: args.uid }, "tool invoked");
      return pantryStartGuard(ctx.self).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.self.store.get(args.uid);

          if (!existing) {
            return textResult(`No pantry item found with UID "${args.uid}" (it may not exist or was already deleted).`);
          }

          const trashed = { ...existing, deleted: true };

          try {
            const saved = (await ctx.infra.client.savePantryItems([trashed]))[0]!;
            await ctx.self.commitPantryItem(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "savePantryItems failed");
            return textResult(`Failed to delete pantry item: ${message}`);
          }

          return textResult(`Pantry item "${existing.ingredient}" has been deleted.`);
        },
        (guard) => guard,
      );
    },
  );
}
