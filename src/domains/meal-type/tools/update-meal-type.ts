import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MealTypeState, MealTypeWrites } from "../module.js";
import type { MealType } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { renderCatalogOrder, repositionCatalog, sortCatalog } from "../../../shared/catalog.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { MealTypeUidSchema } from "../ids.js";
import { mealTypeStartGuard } from "./guards.js";

/**
 * `update_meal_type` — rename, recolor, and/or reposition a meal type (built-ins
 * included; `originalType` is untouched, so a renamed built-in keeps resolving for
 * `{builtin}` specs). Calendar-export settings (`exportAllDay`/`exportTime`) are
 * deliberately not exposed: they configure the Paprika app's device-calendar
 * export, which has no observable effect on this surface.
 */
export const updateMealTypeTool = defineTool(
  {
    name: "update_meal_type",
    title: "Rename, recolor, or reorder a meal type",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description:
      "Rename a meal type, change its display color, and/or move it to a new position in the meal-type " +
      "order. Pass `name` to rename, `color` (hex, e.g. #4A90D9) to recolor, `position` (1-based, as " +
      "shown by `list_meal_types`) to move, or any combination. Existing meals and menu items follow " +
      "the rename automatically.",
    inputSchema: {
      uid: MealTypeUidSchema.describe("UID of the meal type to update (from list_meal_types)"),
      name: z.string().min(1).optional().describe("New display name (omit to leave unchanged)"),
      color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/, "Color must be a 6-digit hex code like #4A90D9")
        .optional()
        .describe("New display color as a 6-digit hex code, e.g. #4A90D9 (omit to leave unchanged)"),
      position: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("New 1-based position in the meal-type order (omit to leave unchanged)"),
    },
  },
  [mealTypeStartGuard],
  (ctx: DomainCtx<MealTypeState, never, MealTypeWrites>) => {
    const log = ctx.infra.log.child({ component: "update_meal_type" });
    return async (args) => {
      const existing = ctx.state.store.get(args.uid);
      if (existing === undefined) {
        return textResult(`No meal type found with UID "${args.uid}" (see list_meal_types for the catalog).`);
      }

      if (args.name === undefined && args.color === undefined && args.position === undefined) {
        return textResult("Nothing to update: provide `name`, `color`, `position`, or any combination.");
      }

      const newName = args.name?.trim();
      if (newName !== undefined) {
        if (newName === "") return textResult("Meal type name cannot be empty.");
        const clash = ctx.state.store.resolveByName(newName);
        if (clash !== undefined && clash.uid !== existing.uid) {
          return textResult(`A meal type named "${clash.name}" already exists — meal type names must be unique.`);
        }
      }

      const target: MealType = {
        ...existing,
        name: newName ?? existing.name,
        color: args.color ?? existing.color,
      };
      const sorted = sortCatalog(ctx.state.store.getAll());

      // Rename/recolor-only edits don't touch order flags (they may be sparse;
      // renumbering would rewrite the whole catalog for a one-type edit); a
      // reposition renumbers contiguously via the shared repositionCatalog.
      const ordered: Array<MealType> =
        args.position === undefined
          ? sorted.map((mt) => (mt.uid === target.uid ? target : mt))
          : repositionCatalog(sorted, target, args.position);

      const toSave = ordered.filter((mt) => {
        const prev = ctx.state.store.get(mt.uid);
        return (
          prev === undefined || prev.name !== mt.name || prev.color !== mt.color || prev.orderFlag !== mt.orderFlag
        );
      });
      if (toSave.length === 0) {
        return textResult(`No changes — "${existing.name}" already has that name/color/position.`);
      }

      return (await ctx.infra.client.saveMealTypes(toSave)).match(
        async (): Promise<CallToolResult> => {
          const commitErr = commitFailure("meal type", await ctx.writes.commitMealTypes(toSave));
          if (commitErr) return commitErr;

          const did: Array<string> = [];
          if (newName !== undefined && newName !== existing.name) did.push(`renamed to "${newName}"`);
          if (args.color !== undefined && args.color !== existing.color) did.push(`recolored to ${args.color}`);
          // Report where the type actually LANDED — a past-the-end position
          // clamps to last, so echoing args.position would contradict the
          // rendered order below.
          if (args.position !== undefined) {
            const landed = ordered.findIndex((mt) => mt.uid === target.uid) + 1;
            did.push(`moved to position ${String(landed)}`);
          }
          return textResult(
            `Updated meal type "${existing.name}": ${did.join(", ")}.\n\nCurrent meal-type order:\n${renderCatalogOrder(
              sortCatalog(ctx.state.store.getAll()),
            )}`,
          );
        },
        async (e) => {
          log.error({ err: e, uid: args.uid }, "saveMealTypes failed");
          return textResult(`Failed to update meal type: ${e.message}`);
        },
      );
    };
  },
);
