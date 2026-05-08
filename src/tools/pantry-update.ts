import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PantryItemUidSchema } from "../paprika/types.js";
import type { PantryItem } from "../paprika/types.js";
import { textResult } from "./helpers.js";
import { commitPantryItem, pantryItemToMarkdown, pantryStartGuard } from "./pantry-helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerUpdatePantryItemTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "update_pantry_item",
    {
      description:
        "Update an existing pantry item by UID. Only provided fields are changed; " +
        "omitted fields retain their existing values. Setting expirationDate also " +
        "updates hasExpiration accordingly.",
      inputSchema: {
        uid: z.string().describe("Pantry item UID to update"),
        ingredient: z.string().optional().describe("New ingredient name"),
        quantity: z.string().optional().describe("New quantity"),
        aisle: z.string().optional().describe("New aisle (display name)"),
        expirationDate: z
          .string()
          .nullable()
          .optional()
          .describe("Set expiration date; pass null to clear. hasExpiration is derived from this."),
        inStock: z.boolean().optional().describe("Set in-stock status"),
        notes: z.string().nullable().optional().describe("Set notes; pass null to clear"),
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

          // Auto-derive hasExpiration when expirationDate is explicitly provided (AC5.3)
          // When provided (string or null), derive hasExpiration; when omitted (undefined), leave both as-is
          const expirationDateProvided = args.expirationDate !== undefined;
          const newExpirationDate: string | null = expirationDateProvided
            ? (args.expirationDate as string | null) // narrowed from string | null | undefined
            : existing.expirationDate;
          const newHasExpiration = expirationDateProvided ? newExpirationDate !== null : existing.hasExpiration;

          const updated: PantryItem = {
            ...existing,
            ...(args.ingredient !== undefined && { ingredient: args.ingredient }),
            ...(args.quantity !== undefined && { quantity: args.quantity }),
            ...(args.aisle !== undefined && { aisle: args.aisle }),
            ...(args.inStock !== undefined && { inStock: args.inStock }),
            ...(args.notes !== undefined && { notes: args.notes }),
            expirationDate: newExpirationDate,
            hasExpiration: newHasExpiration,
          };

          let saved: PantryItem;
          try {
            saved = await ctx.client.savePantryItem(updated);
            await commitPantryItem(ctx, saved);
          } catch (error) {
            return textResult(
              `Failed to update pantry item: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          return textResult(pantryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    },
  );
}
