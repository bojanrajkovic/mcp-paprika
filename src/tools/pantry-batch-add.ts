import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { AisleUid } from "../ids.js";
import type { PantryItem } from "../pantry/types.js";
import type { ServerContext } from "../types/server-context.js";

import { NO_AISLE_UID, PantryItemUidSchema } from "../ids.js";
import { normalizeWire, todayWire } from "../utils/dates.js";
// pattern: Imperative Shell
import { toMessage } from "../utils/log.js";
import { ensureAisle } from "./aisle-helpers.js";
import { textResult } from "./helpers.js";
import { commitPantryItemsBatch, pantryItemToMarkdown, pantryStartGuard } from "./pantry-helpers.js";

const itemInputSchema = z.object({
  ingredient: z.string().min(1).describe("Ingredient name (required)"),
  quantity: z.string().optional().describe("Quantity, e.g. '1 lb'"),
  aisle: z
    .string()
    .optional()
    .describe(
      "Aisle display name; call list_aisles first to pick an existing name. Unknown names auto-create a new aisle.",
    ),
  expirationDate: z.string().optional().describe("Expiration date as ISO string; sets hasExpiration=true"),
  purchaseDate: z.string().optional().describe("Purchase date as ISO string (default: today)"),
  inStock: z.boolean().optional().describe("Whether the item is currently in stock (default: true)"),
});

export function registerAddPantryItemsTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "add_pantry_items" });
  server.registerTool(
    "add_pantry_items",
    {
      title: "Add items to the pantry",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      description:
        "Add one or more items to the pantry. Skips items that duplicate an existing ingredient (case-insensitive) " +
        "and reports them with the existing UID and a suggestion to use update_pantry_item. " +
        "All date fields are validated up-front; a single unparseable date rejects the entire batch.",
      inputSchema: {
        items: z.array(itemInputSchema).min(1).describe("Array of items to add (1 or more)"),
      },
    },
    async (args) => {
      log.info({ tool: "add_pantry_items", count: args.items.length }, "tool invoked");
      return pantryStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Phase 1: All-or-nothing date validation
          type NormalizedDates = { expirationDate: string | null; purchaseDate: string };
          const normalizedDates: Array<NormalizedDates> = [];
          for (let i = 0; i < args.items.length; i++) {
            const item = args.items[i]!;

            const expirationDate = item.expirationDate !== undefined ? normalizeWire(item.expirationDate) : null;
            if (item.expirationDate !== undefined && expirationDate === null) {
              return textResult(
                `Item ${i.toString()} ("${item.ingredient}"): could not parse expirationDate "${item.expirationDate}". ` +
                  `Use ISO 8601 (e.g., "2026-12-31") or "yyyy-MM-dd HH:mm:ss".`,
              );
            }

            let purchaseDate: string;
            if (item.purchaseDate !== undefined) {
              const parsedPurchase = normalizeWire(item.purchaseDate);
              if (parsedPurchase === null) {
                return textResult(
                  `Item ${i.toString()} ("${item.ingredient}"): could not parse purchaseDate "${item.purchaseDate}". ` +
                    `Use ISO 8601 (e.g., "2026-12-31") or "yyyy-MM-dd HH:mm:ss".`,
                );
              }
              purchaseDate = parsedPurchase;
            } else {
              purchaseDate = todayWire();
            }

            normalizedDates.push({ expirationDate, purchaseDate });
          }

          // Phase 2: Duplicate detection (skip-and-report)
          const skipMessages: Array<string> = [];
          const toAdd: Array<{ index: number; item: (typeof args.items)[number]; dates: NormalizedDates }> = [];
          const seenIngredients = new Map<string, string>(); // lowercase ingredient → ingredient name (first occurrence)

          for (let i = 0; i < args.items.length; i++) {
            const item = args.items[i]!;
            const dates = normalizedDates[i]!;
            const key = item.ingredient.toLowerCase();

            const intraMatch = seenIngredients.get(key);
            if (intraMatch !== undefined) {
              skipMessages.push(
                `Skipped "${item.ingredient}" (item ${i.toString()}): duplicates "${intraMatch}" in this batch.`,
              );
              continue;
            }

            const existingMatches = ctx.pantryStore.findByIngredient(item.ingredient);
            const existing = existingMatches[0];
            if (existing !== undefined && existing.ingredient.toLowerCase() === key) {
              skipMessages.push(
                `Skipped "${item.ingredient}" (item ${i.toString()}): already exists (UID: ${existing.uid}). ` +
                  `Use update_pantry_item with this UID to merge quantities.`,
              );
              continue;
            }

            seenIngredients.set(key, item.ingredient);
            toAdd.push({ index: i, item, dates });
          }

          if (toAdd.length === 0) {
            const skipReport = skipMessages.join("\n");
            return textResult(`All items were duplicates and skipped.\n\n${skipReport}`);
          }

          // Phase 3: Build PantryItem objects with aisle resolution
          const builtItems: Array<PantryItem> = [];
          const batchAisleCache = new Map<string, { aisle: string; aisleUid: AisleUid }>();
          try {
            for (const { item, dates } of toAdd) {
              const uid = PantryItemUidSchema.parse(crypto.randomUUID().toUpperCase());

              let aisle: string;
              let aisleUid: AisleUid;

              const aisleInput = item.aisle ?? "";
              if (aisleInput === "") {
                aisle = "";
                aisleUid = NO_AISLE_UID;
              } else {
                const aisleKey = aisleInput.toLowerCase();
                const cached = batchAisleCache.get(aisleKey);
                if (cached !== undefined) {
                  aisle = cached.aisle;
                  aisleUid = cached.aisleUid;
                } else {
                  const resolved = await ensureAisle(ctx, aisleInput);
                  aisle = resolved.aisle;
                  aisleUid = resolved.aisleUid;
                  batchAisleCache.set(aisleKey, { aisle, aisleUid });
                }
              }

              builtItems.push({
                uid,
                ingredient: item.ingredient,
                quantity: item.quantity ?? "",
                aisle,
                aisleUid,
                expirationDate: dates.expirationDate,
                hasExpiration: dates.expirationDate !== null,
                inStock: item.inStock ?? true,
                purchaseDate: dates.purchaseDate,
                notes: null,
                deleted: false,
              });
            }
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error }, "aisle resolution failed");
            return textResult(`Failed to add pantry items: ${message}`);
          }

          // Phase 4: Single batch POST + commit
          let savedItems: ReadonlyArray<PantryItem>;
          try {
            savedItems = await ctx.client.savePantryItems(builtItems);
            await commitPantryItemsBatch(ctx, savedItems);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error }, "savePantryItems failed");
            return textResult(`Failed to add pantry items: ${message}`);
          }

          // Phase 5: Build response
          const count = savedItems.length;
          const rendered = savedItems.map((item) => pantryItemToMarkdown(item)).join("\n\n---\n\n");
          const header = `Added ${count.toString()} item(s) to the pantry.`;

          if (skipMessages.length > 0) {
            const skipReport = skipMessages.join("\n");
            return textResult(`${header}\n\n${rendered}\n\n---\n\n**Skipped (duplicates):**\n${skipReport}`);
          }

          return textResult(`${header}\n\n${rendered}`);
        },
        (guard) => guard,
      );
    },
  );
}
