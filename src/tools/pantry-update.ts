import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PantryItemUidSchema } from "../paprika/types.js";
import type { PantryItem } from "../paprika/types.js";
import { normalizePaprikaDate } from "../paprika/dates.js";
import { textResult } from "./helpers.js";
import { ensureAisle } from "./aisle-helpers.js";
import { commitPantryItem, pantryItemToMarkdown, pantryStartGuard } from "./pantry-helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerUpdatePantryItemTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "update_pantry_item" });
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
      log.info({ tool: "update_pantry_item", uid: args.uid }, "tool invoked");
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = PantryItemUidSchema.parse(args.uid);
          const existing = ctx.pantryStore.get(uid);

          if (!existing) {
            return textResult(`No pantry item found with UID "${args.uid}".`);
          }

          // Auto-derive hasExpiration when expirationDate is explicitly provided (AC5.3).
          // When provided (string or null), derive hasExpiration; when omitted (undefined),
          // leave both as-is. User-supplied date strings are normalized to Paprika's
          // wire format ("yyyy-MM-dd HH:mm:ss") so the LLM can pass ISO 8601 freely.
          let newExpirationDate: string | null;
          if (args.expirationDate === undefined) {
            newExpirationDate = existing.expirationDate;
          } else if (args.expirationDate === null) {
            newExpirationDate = null;
          } else {
            const normalized = normalizePaprikaDate(args.expirationDate);
            if (normalized === null) {
              return textResult(
                `Could not parse expirationDate "${args.expirationDate}". Use ISO 8601 (e.g., "2026-12-31") or "yyyy-MM-dd HH:mm:ss".`,
              );
            }
            newExpirationDate = normalized;
          }
          const newHasExpiration =
            args.expirationDate !== undefined ? args.expirationDate !== null : existing.hasExpiration;

          // Resolve aisle: when provided, look up or auto-create to get both
          // the display name and its UID (fixes the stale-UID bug where the
          // old code updated `aisle` display but left `aisleUid` stale).
          const aisleUpdate = args.aisle !== undefined ? await ensureAisle(ctx, args.aisle) : undefined;

          const updated: PantryItem = {
            ...existing,
            ...(args.ingredient !== undefined && { ingredient: args.ingredient }),
            ...(args.quantity !== undefined && { quantity: args.quantity }),
            ...(aisleUpdate !== undefined && { aisle: aisleUpdate.aisle, aisleUid: aisleUpdate.aisleUid }),
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
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "savePantryItem failed");
            return textResult(`Failed to update pantry item: ${message}`);
          }

          return textResult(pantryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    },
  );
}
