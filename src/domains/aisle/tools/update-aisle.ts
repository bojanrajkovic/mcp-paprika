import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { AisleState, AisleWrites } from "../module.js";
import type { Aisle } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { renderCatalogOrder, repositionCatalog, sortCatalog } from "../../../shared/catalog.js";
import { commitFailure, toolResult } from "../../../shared/tools.js";
import { AisleUidSchema } from "../ids.js";
import { aisleStartGuard } from "./guards.js";

/**
 * `update_aisle` — rename and/or reposition an aisle. Renames do NOT rewrite the
 * grocery/pantry items that denormalize the aisle name: rendering resolves names
 * through the live catalog (see grocery-helpers.ts), so one catalog write is the
 * whole rename. A reposition renumbers the catalog to contiguous order flags and
 * saves only the aisles whose flag (or name) actually changed.
 */
export const updateAisleTool = defineTool(
  {
    name: "update_aisle",
    title: "Rename or reorder a grocery aisle",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description:
      "Rename an aisle and/or move it to a new position in the aisle order (the order you walk the store). " +
      "Pass `name` to rename, `position` (1-based, as shown by `list_aisles`) to move, or both. " +
      "Existing grocery and pantry items follow the rename automatically.",
    inputSchema: {
      uid: AisleUidSchema.describe("UID of the aisle to update (from list_aisles)"),
      name: z.string().min(1).optional().describe("New display name (omit to leave unchanged)"),
      position: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("New 1-based position in the aisle order (omit to leave unchanged)"),
    },
  },
  [aisleStartGuard],
  (ctx: DomainCtx<AisleState, never, AisleWrites>) => {
    const log = ctx.infra.log.child({ component: "update_aisle" });
    // The whole lookup → clash-check → save → commit sequence runs under the
    // catalog write lock (shared with ensureAisle/deleteAisle): without it, two
    // concurrent renames to one name both pass the clash check before either
    // commits, breaking name uniqueness.
    return async (args) =>
      ctx.writes.withCatalogWriteLock(async () => {
        const existing = ctx.state.store.get(args.uid);
        if (existing === undefined) {
          return toolResult(`No aisle found with UID "${args.uid}" (see list_aisles for the catalog).`);
        }

        if (args.name === undefined && args.position === undefined) {
          return toolResult("Nothing to update: provide `name`, `position`, or both.");
        }

        const newName = args.name?.trim();
        if (newName !== undefined) {
          if (newName === "") return toolResult("Aisle name cannot be empty.");
          const clash = ctx.state.store.resolveByName(newName);
          if (clash !== undefined && clash.uid !== existing.uid) {
            return toolResult(`An aisle named "${clash.name}" already exists — aisle names must be unique.`);
          }
        }

        const target: Aisle = { ...existing, name: newName ?? existing.name };
        const sorted = sortCatalog(ctx.state.store.getAll());

        // Rename-only edits don't touch order flags (they may be sparse; renumbering
        // would rewrite the whole catalog for a one-aisle rename); a reposition
        // renumbers contiguously via the shared repositionCatalog.
        const ordered: Array<Aisle> =
          args.position === undefined
            ? sorted.map((a) => (a.uid === target.uid ? target : a))
            : repositionCatalog(sorted, target, args.position);

        const toSave = ordered.filter((a) => {
          const prev = ctx.state.store.get(a.uid);
          return prev === undefined || prev.name !== a.name || prev.orderFlag !== a.orderFlag;
        });
        if (toSave.length === 0) {
          return toolResult(`No changes — "${existing.name}" already has that name/position.`);
        }

        return (await ctx.infra.client.saveAisles(toSave)).match(
          async (): Promise<CallToolResult> => {
            const commitErr = commitFailure("aisle", await ctx.writes.commitAisles(toSave));
            if (commitErr) return commitErr;

            const did: Array<string> = [];
            if (newName !== undefined && newName !== existing.name) did.push(`renamed to "${newName}"`);
            // Report where the aisle actually LANDED — a past-the-end position
            // clamps to last, so echoing args.position would contradict the
            // rendered order below.
            if (args.position !== undefined) {
              const landed = ordered.findIndex((a) => a.uid === target.uid) + 1;
              did.push(`moved to position ${String(landed)}`);
            }
            return toolResult(
              `Updated aisle "${existing.name}": ${did.join(", ")}.\n\nCurrent aisle order:\n${renderCatalogOrder(
                sortCatalog(ctx.state.store.getAll()),
              )}`,
            );
          },
          async (e) => {
            log.error({ err: e, uid: args.uid }, "saveAisles failed");
            return toolResult(`Failed to update aisle: ${e.message}`);
          },
        );
      });
  },
);
