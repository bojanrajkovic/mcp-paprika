import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { PantryState, PantryWrites } from "../module.js";
import type { PantryItem } from "../types.js";

import { PantryItemUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { normalizeWire } from "../../../utils/dates.js";
import { toMessage } from "../../../utils/log.js";
import { pantryItemToMarkdown } from "../pantry-helpers.js";
import { pantryStartGuard } from "./guards.js";

// Strict (exported for direct Zod-validation tests). `inStock` was promoted to
// the mark_pantry_item_out_of_stock / restock_pantry_item intent verbs, so a
// stray `inStock` key here is a loud rejection, not a silently dropped field.
export const updatePantryItemInputSchema = z
  .object({
    uid: PantryItemUidSchema.describe("Pantry item UID to update"),
    ingredient: z.string().optional().describe("New ingredient name"),
    quantity: z.string().optional().describe("New quantity"),
    aisle: z
      .string()
      .optional()
      .describe(
        "New aisle display name; call list_aisles first to pick an existing name. Unknown names auto-create a new aisle.",
      ),
    expirationDate: z
      .string()
      .nullable()
      .optional()
      .describe("Set expiration date; pass null to clear. hasExpiration is derived from this."),
    purchaseDate: z.string().nullable().optional().describe("Set purchase date; pass null to clear"),
  })
  .strict();

/**
 * `update_pantry_item` — edit a pantry item's free-form fields. Resolves a changed
 * aisle through the declared `aisle` dependency contract (`ctx.deps.aisle.ensureAisle`).
 */
export const updatePantryItemTool = defineTool(
  {
    name: "update_pantry_item",
    title: "Edit a pantry item",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Update a pantry item's ingredient, quantity, aisle, or dates by UID. Only provided fields are " +
      "changed; omitted fields retain their existing values. Setting expirationDate also updates " +
      "hasExpiration accordingly. To change stock status, use mark_pantry_item_out_of_stock / restock_pantry_item.",
    inputSchema: updatePantryItemInputSchema,
  },
  (ctx: DomainCtx<PantryState, "aisle", PantryWrites>) => {
    const log = ctx.infra.log.child({ component: "update_pantry_item" });
    return async (args) => {
      log.info({ tool: "update_pantry_item", uid: args.uid }, "tool invoked");
      return pantryStartGuard(ctx.state).match(
        async (): Promise<CallToolResult> => {
          const existing = ctx.state.store.get(args.uid);

          if (!existing) {
            return textResult(`No pantry item found with UID "${args.uid}" (it may not exist or was already deleted).`);
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
            const normalized = normalizeWire(args.expirationDate);
            if (normalized === null) {
              return textResult(
                `Could not parse expirationDate "${args.expirationDate}". Use ISO 8601 (e.g., "2026-12-31") or "yyyy-MM-dd HH:mm:ss".`,
              );
            }
            newExpirationDate = normalized;
          }
          const newHasExpiration =
            args.expirationDate !== undefined ? args.expirationDate !== null : existing.hasExpiration;

          let newPurchaseDate: string | null;
          if (args.purchaseDate === undefined) {
            newPurchaseDate = existing.purchaseDate;
          } else if (args.purchaseDate === null) {
            newPurchaseDate = null;
          } else {
            const normalized = normalizeWire(args.purchaseDate);
            if (normalized === null) {
              return textResult(
                `Could not parse purchaseDate "${args.purchaseDate}". Use ISO 8601 (e.g., "2026-12-31") or "yyyy-MM-dd HH:mm:ss".`,
              );
            }
            newPurchaseDate = normalized;
          }

          let saved: PantryItem;
          try {
            // Resolve aisle: when provided, look up or auto-create to get both
            // the display name and its UID (fixes the stale-UID bug where the
            // old code updated `aisle` display but left `aisleUid` stale).
            const aisleUpdate =
              args.aisle !== undefined
                ? (await ctx.deps.aisle.ensureAisle(args.aisle)).match(
                    (v) => v,
                    (message) => textResult(message),
                  )
                : undefined;
            if (aisleUpdate !== undefined && "content" in aisleUpdate) return aisleUpdate;

            const updated: PantryItem = {
              ...existing,
              ...(args.ingredient !== undefined && { ingredient: args.ingredient }),
              ...(args.quantity !== undefined && { quantity: args.quantity }),
              ...(aisleUpdate !== undefined && { aisle: aisleUpdate.aisle, aisleUid: aisleUpdate.aisleUid }),
              expirationDate: newExpirationDate,
              hasExpiration: newHasExpiration,
              purchaseDate: newPurchaseDate,
            };
            saved = (await ctx.infra.client.savePantryItems([updated]))[0]!;
            const commitErr = commitFailure("pantry", await ctx.writes.commitPantryItem(saved));
            if (commitErr) return commitErr;
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: args.uid }, "savePantryItems failed");
            return textResult(`Failed to update pantry item: ${message}`);
          }

          return textResult(pantryItemToMarkdown(saved));
        },
        (guard) => guard,
      );
    };
  },
);
