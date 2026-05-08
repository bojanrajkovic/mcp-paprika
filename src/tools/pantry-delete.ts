import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PantryItemUidSchema } from "../paprika/types.js";
import { textResult } from "./helpers.js";
import { commitPantryItem, pantryStartGuard } from "./pantry-helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerDeletePantryItemTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "delete_pantry_item",
    {
      description:
        "Soft-delete a pantry item by UID. Idempotent: a second delete on the same UID " +
        "returns a friendly 'already deleted' message without re-saving. Requires an exact UID.",
      inputSchema: {
        uid: z.string().describe("Pantry item UID to delete"),
      },
    },
    async (args) => {
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = PantryItemUidSchema.parse(args.uid);
          const existing = ctx.pantryStore.get(uid);

          if (!existing) {
            // Idempotent retry path: a successful prior delete removes the item
            // from the local store (commitPantryItem's delete branch calls
            // pantryStore.delete). We can't distinguish "never created" from
            // "already deleted" without an extra round-trip, so the message
            // covers both — either way the caller's retry is safe and no
            // server state changes.
            return textResult(
              `No pantry item present with UID "${args.uid}". The item was either never created or has already been deleted; no action taken.`,
            );
          }

          if (existing.deleted) {
            // This branch fires only when a tombstone is observed in the store,
            // which currently happens only in tests (production flow removes the
            // item entirely on commit). Kept for defense-in-depth in case the
            // store later starts retaining tombstones.
            return textResult(`Pantry item "${existing.ingredient}" is already deleted.`);
          }

          const trashed = { ...existing, deleted: true };

          try {
            const saved = await ctx.client.savePantryItem(trashed);
            await commitPantryItem(ctx, saved);
          } catch (error) {
            return textResult(
              `Failed to delete pantry item: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          return textResult(`Pantry item "${existing.ingredient}" has been deleted.`);
        },
        (guard) => guard,
      );
    },
  );
}
