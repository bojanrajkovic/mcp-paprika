import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryState, PantryWrites } from "../module.js";

import { PantryItemUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { pantryStartGuard } from "./guards.js";

/**
 * `delete_pantry_item` — remove a pantry item (soft-delete tombstone).
 */
export const deletePantryItemTool = defineTool(
  {
    name: "delete_pantry_item",
    title: "Delete a pantry item",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Soft-delete a pantry item by UID. Idempotent: a second delete on the same UID " +
      "returns a friendly 'already deleted' message without re-saving. Requires an exact UID.",
    inputSchema: {
      uid: PantryItemUidSchema.describe("Pantry item UID to delete"),
    },
  },
  (ctx: DomainCtx<PantryState, "aisle", PantryWrites>) => {
    const log = ctx.infra.log.child({ component: "delete_pantry_item" });
    return async (args) => {
      log.info({ tool: "delete_pantry_item", uid: args.uid }, "tool invoked");
      return pantryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.store.get(args.uid);

          if (!existing) {
            return textResult(`No pantry item found with UID "${args.uid}" (it may not exist or was already deleted).`);
          }

          const trashed = { ...existing, deleted: true };

          return (await ctx.infra.client.savePantryItems([trashed])).match(
            async (items): Promise<CallToolResult> => {
              const commitErr = commitFailure("pantry", await ctx.writes.commitPantryItem(items[0]!));
              if (commitErr) return commitErr;
              return textResult(`Pantry item "${existing.ingredient}" has been deleted.`);
            },
            async (e) => {
              log.error({ err: e, uid: args.uid }, "savePantryItems failed");
              return textResult(`Failed to delete pantry item: ${e.message}`);
            },
          );
        },
        (guard) => guard,
      );
    };
  },
);
