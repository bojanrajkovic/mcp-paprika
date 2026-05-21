import { createLogger, toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PantryItemUidSchema } from "../paprika/types.js";
import { textResult } from "./helpers.js";
import { commitPantryItem, pantryStartGuard } from "./pantry-helpers.js";
import type { ServerContext } from "../types/server-context.js";

const log = createLogger("mcp-paprika:delete_pantry_item");

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
            // Distinguish "I deleted this in this session" (tombstone) from
            // "never existed". The store's tombstone set tracks UIDs deleted
            // via this client since the last sync; a retried delete on a
            // previously-deleted UID returns the idempotent "already deleted"
            // signal callers expect.
            if (ctx.pantryStore.isTombstone(uid)) {
              return textResult(`Pantry item with UID "${args.uid}" is already deleted.`);
            }
            return textResult(`No pantry item found with UID "${args.uid}".`);
          }

          if (existing.deleted) {
            // Defense-in-depth: if a tombstone ever lands in the items map
            // (e.g., from a future sync that returns deleted items), still
            // report it as already-deleted rather than re-saving.
            return textResult(`Pantry item "${existing.ingredient}" is already deleted.`);
          }

          const trashed = { ...existing, deleted: true };

          try {
            const saved = await ctx.client.savePantryItem(trashed);
            await commitPantryItem(ctx, saved);
          } catch (error) {
            const message = toMessage(error);
            log(`savePantryItem (soft-delete) failed for uid=${trashed.uid}: ${message}`);
            return textResult(`Failed to delete pantry item: ${message}`);
          }

          return textResult(`Pantry item "${existing.ingredient}" has been deleted.`);
        },
        (guard) => guard,
      );
    },
  );
}
