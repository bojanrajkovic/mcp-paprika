import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { AisleState, AisleWrites } from "../module.js";
import type { Aisle } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { AisleUidSchema } from "../ids.js";
import { aisleStartGuard } from "./guards.js";

/** The catalog in display order — the same sort `list_aisles` renders. */
function sortedCatalog(state: AisleState): Array<Aisle> {
  return state.store
    .getAll()
    .slice()
    .sort((a, b) => {
      if (a.orderFlag !== b.orderFlag) return a.orderFlag - b.orderFlag;
      return a.name.localeCompare(b.name);
    });
}

/** Render the catalog as a numbered order listing for the tool response. */
function renderOrder(aisles: ReadonlyArray<Aisle>): string {
  return aisles.map((a, i) => `${String(i + 1)}. **${a.name}** — \`${a.uid}\``).join("\n");
}

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
    return async (args) => {
      const existing = ctx.state.store.get(args.uid);
      if (existing === undefined) {
        return textResult(`No aisle found with UID "${args.uid}" (see list_aisles for the catalog).`);
      }

      if (args.name === undefined && args.position === undefined) {
        return textResult("Nothing to update: provide `name`, `position`, or both.");
      }

      const newName = args.name?.trim();
      if (newName !== undefined) {
        if (newName === "") return textResult("Aisle name cannot be empty.");
        const clash = ctx.state.store.resolveByName(newName);
        if (clash !== undefined && clash.uid !== existing.uid) {
          return textResult(`An aisle named "${clash.name}" already exists — aisle names must be unique.`);
        }
      }

      const target: Aisle = { ...existing, name: newName ?? existing.name };
      const sorted = sortedCatalog(ctx.state);

      let ordered: Array<Aisle>;
      if (args.position === undefined) {
        // Rename-only: don't touch order flags (they may be sparse; renumbering
        // here would rewrite the whole catalog for a one-aisle rename).
        ordered = sorted.map((a) => (a.uid === target.uid ? target : a));
      } else {
        // Reposition: remove, insert at the clamped index, renumber contiguously.
        const without = sorted.filter((a) => a.uid !== target.uid);
        const idx = Math.min(args.position - 1, without.length);
        ordered = [...without.slice(0, idx), target, ...without.slice(idx)].map((a, i) =>
          a.orderFlag === i ? a : { ...a, orderFlag: i },
        );
      }

      const toSave = ordered.filter((a) => {
        const prev = ctx.state.store.get(a.uid);
        return prev === undefined || prev.name !== a.name || prev.orderFlag !== a.orderFlag;
      });
      if (toSave.length === 0) {
        return textResult(`No changes — "${existing.name}" already has that name/position.`);
      }

      return (await ctx.infra.client.saveAisles(toSave)).match(
        async (): Promise<CallToolResult> => {
          const commitErr = commitFailure("aisle", await ctx.writes.commitAisles(toSave));
          if (commitErr) return commitErr;

          const did: Array<string> = [];
          if (newName !== undefined && newName !== existing.name) did.push(`renamed to "${newName}"`);
          if (args.position !== undefined) did.push(`moved to position ${String(args.position)}`);
          return textResult(
            `Updated aisle "${existing.name}": ${did.join(", ")}.\n\nCurrent aisle order:\n${renderOrder(
              sortedCatalog(ctx.state),
            )}`,
          );
        },
        async (e) => {
          log.error({ err: e, uid: args.uid }, "saveAisles failed");
          return textResult(`Failed to update aisle: ${e.message}`);
        },
      );
    };
  },
);
