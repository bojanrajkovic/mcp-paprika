import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuState, MenuWrites } from "../module.js";
import type { Menu } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, errorResult, structuredResult } from "../../../shared/tools.js";
import { MenuUidSchema } from "../ids.js";
import { menuReadOutputSchema, menuToReadStructured } from "../menu-helpers.js";
import { menuStartGuard } from "./guards.js";

/**
 * `create_menu` — create a menu. Renders with the meal-type catalog from
 * `ctx.deps["meal-type"]`.
 */
export const createMenuTool = defineTool(
  {
    name: "create_menu",
    title: "Create a menu",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    description:
      "Create a new menu (saved meal plan) with the given name. Rejects duplicate names " +
      "(case-insensitive exact match); if a duplicate is found, the response includes the existing UID. " +
      "Optionally set the day span (default 1) and free-text notes.",
    inputSchema: {
      name: z.string().min(1).describe("Menu name (required)"),
      days: z.number().int().positive().optional().default(1).describe("Day span of the menu (>= 1, default 1)"),
      notes: z.string().optional().default("").describe("Optional free-text notes for the menu"),
    },
    outputSchema: menuReadOutputSchema,
  },
  [menuStartGuard],
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type", MenuWrites>) => {
    const log = ctx.infra.log.child({ component: "create_menu" });
    return async (args) => {
      // `.default()` is applied by the MCP SDK's Zod parse; fall back here so the
      // handler is robust to direct invocation (tests) that bypasses the schema.
      const days = args.days ?? 1;
      const notes = args.notes ?? "";
      // Duplicate-name guard: only reject on exact case-insensitive match.
      // A starts-with or contains hit from findByName is NOT a duplicate.
      const matches = ctx.state.menus.store.findByName(args.name);
      const exactMatch = matches.find((m) => m.name.toLowerCase() === args.name.toLowerCase());
      if (exactMatch !== undefined) {
        return errorResult(
          `A menu named "${exactMatch.name}" already exists (UID: ${exactMatch.uid}). ` +
            `Use update_menu to change it.`,
        );
      }

      // Next free orderFlag so the new menu sorts after existing ones in Paprika order.
      const maxOrderFlag = ctx.state.menus.store.getAll().reduce((max, m) => Math.max(max, m.orderFlag), -1);
      const uid = MenuUidSchema.parse(crypto.randomUUID().toUpperCase());
      const newMenu: Menu = {
        uid,
        name: args.name,
        days,
        orderFlag: maxOrderFlag + 1,
        notes,
        deleted: false,
      };

      return (await ctx.infra.client.saveMenus([newMenu])).match(
        async (saved) => {
          const created = saved[0] ?? newMenu;
          const mealTypes = ctx.deps["meal-type"].getAll();
          const structured = menuToReadStructured(created, [], mealTypes);
          const commitErr = commitFailure("menu", await ctx.writes.commitMenu(created), {
            structuredContent: structured,
          });
          if (commitErr) return commitErr;
          return structuredResult(structured);
        },
        async (e) => {
          log.error({ err: e, name: args.name }, "saveMenus (create_menu) failed");
          return errorResult(`Failed to create menu: ${e.message}`);
        },
      );
    };
  },
);
