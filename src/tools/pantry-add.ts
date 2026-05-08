// pattern: Imperative Shell
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PantryItemUidSchema } from "../paprika/types.js";
import type { PantryItem } from "../paprika/types.js";
import { normalizePaprikaDate, paprikaDateToday } from "../paprika/dates.js";
import { textResult } from "./helpers.js";
import { commitPantryItem, pantryItemToMarkdown, pantryStartGuard } from "./pantry-helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerAddPantryItemTool(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "add_pantry_item",
    {
      description:
        "Add a new item to the pantry. Rejects duplicates by case-insensitive ingredient name; " +
        "if a duplicate is found, the response includes the existing UID and instructs the caller " +
        "to use update_pantry_item instead.",
      inputSchema: {
        ingredient: z.string().min(1).describe("Ingredient name (required)"),
        quantity: z.string().optional().describe("Quantity, e.g. '1 lb'"),
        aisle: z.string().optional().describe("Aisle name (display)"),
        expirationDate: z.string().optional().describe("Expiration date as ISO string; sets hasExpiration=true"),
        inStock: z.boolean().optional().describe("Whether the item is currently in stock (default: true)"),
        notes: z.string().optional().describe("Free-form notes"),
      },
    },
    async (args) => {
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Duplicate-ingredient guard (AC4.5)
          // Under @tsconfig/strictest, noUncheckedIndexedAccess types matches[0] as
          // PantryItem | undefined, so we narrow via a typed local before deref.
          const matches = ctx.pantryStore.findByIngredient(args.ingredient);
          const existing = matches[0];
          if (existing !== undefined && existing.ingredient.toLowerCase() === args.ingredient.toLowerCase()) {
            return textResult(
              `An item with ingredient "${existing.ingredient}" already exists (UID: ${existing.uid}). ` +
                `Use update_pantry_item with this UID to modify it.`,
            );
          }

          // Construct full PantryItem with defaults (per Server-Derived Field Defaults table).
          // Normalize the user-supplied expirationDate to Paprika wire format
          // ("yyyy-MM-dd HH:mm:ss"). Returning null on unparseable input keeps the
          // user from accidentally writing garbage into the field.
          const expirationDate = args.expirationDate !== undefined ? normalizePaprikaDate(args.expirationDate) : null;
          if (args.expirationDate !== undefined && expirationDate === null) {
            return textResult(
              `Could not parse expirationDate "${args.expirationDate}". Use ISO 8601 (e.g., "2026-12-31") or "yyyy-MM-dd HH:mm:ss".`,
            );
          }
          // UUID uppercased to match what the Paprika app emits on the wire and what
          // listPantry returns; Paprika servers accept either case but matching the
          // app keeps round-tripped UIDs consistent.
          const uid = PantryItemUidSchema.parse(crypto.randomUUID().toUpperCase());
          const newItem: PantryItem = {
            uid,
            ingredient: args.ingredient,
            quantity: args.quantity ?? "",
            aisle: args.aisle ?? "",
            aisleUid: "",
            expirationDate,
            hasExpiration: expirationDate !== null, // AC4.2, AC4.3
            inStock: args.inStock ?? true,
            // Today's date at midnight (Paprika's wire format); matches what
            // Paprika.app stamps when the user adds an item.
            purchaseDate: paprikaDateToday(),
            locationUid: null,
            notes: args.notes ?? null,
            deleted: false,
          };

          let saved: PantryItem;
          try {
            saved = await ctx.client.savePantryItem(newItem);
            await commitPantryItem(ctx, saved);
          } catch (error) {
            // AC4.7: store/cache not updated — commitPantryItem not reached
            return textResult(`Failed to add pantry item: ${error instanceof Error ? error.message : String(error)}`);
          }

          return textResult(pantryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    },
  );
}
