import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { TypedCallToolResult } from "../../../shared/tools.js";
import type { AisleState, AisleWrites } from "../module.js";
import type { Aisle } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { repositionCatalog, sortCatalog } from "../../../shared/catalog.js";
import { commitFailure, errorResult, structuredResult } from "../../../shared/tools.js";
import { AisleUidSchema } from "../ids.js";
import { aisleStartGuard } from "./guards.js";
import { buildAisleRows, listAislesOutputSchema } from "./list-aisles.js";

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
    outputSchema: listAislesOutputSchema,
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
          return errorResult(`No aisle found with UID "${args.uid}" (see list_aisles for the catalog).`);
        }

        if (args.name === undefined && args.position === undefined) {
          return errorResult("Nothing to update: provide `name`, `position`, or both.");
        }

        const newName = args.name?.trim();
        if (newName !== undefined) {
          if (newName === "") return errorResult("Aisle name cannot be empty.");
          const clash = ctx.state.store.resolveByName(newName);
          if (clash !== undefined && clash.uid !== existing.uid) {
            return errorResult(`An aisle named "${clash.name}" already exists — aisle names must be unique.`);
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
          return structuredResult({ items: buildAisleRows(ctx.state) });
        }

        return (await ctx.infra.client.saveAisles(toSave)).match(
          async (): Promise<TypedCallToolResult<z.infer<typeof listAislesOutputSchema>>> => {
            const commitErr = commitFailure("aisle", await ctx.writes.commitAisles(toSave), {
              structuredContent: { items: buildAisleRows(ctx.state) },
            });
            if (commitErr) return commitErr;

            // The whole post-commit catalog rides the structured payload (the same
            // full-list shape list_aisles produces), so the model sees the new names
            // and order — the specific changes are derivable from it.
            return structuredResult({ items: buildAisleRows(ctx.state) });
          },
          async (e) => {
            log.error({ err: e, uid: args.uid }, "saveAisles failed");
            return errorResult(`Failed to update aisle: ${e.message}`);
          },
        );
      });
  },
);
