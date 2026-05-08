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
            return textResult(`No pantry item found with UID "${args.uid}".`);
          }

          if (existing.deleted) {
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
