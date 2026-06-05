import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuSelf } from "../module.js";
import type { Menu } from "../types.js";

import { MenuUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { menuToMarkdown } from "../menu-helpers.js";
import { menuStartGuard } from "./guards.js";

/**
 * Registers `create_menu`, kernel-shaped — reads/writes this module's own menu store
 * via `ctx.self`, commits through `ctx.self.commitMenu`, and renders with the
 * meal-type catalog from `ctx.deps["meal-type"]`.
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
  },
  (ctx: DomainCtx<MenuSelf, "recipe" | "meal-type">) => {
    const log = ctx.infra.log.child({ component: "create_menu" });
    return async (args) => {
      // `.default()` is applied by the MCP SDK's Zod parse; fall back here so the
      // handler is robust to direct invocation (tests) that bypasses the schema.
      const days = args.days ?? 1;
      const notes = args.notes ?? "";
      log.info({ tool: "create_menu", name: args.name, days }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Duplicate-name guard: only reject on exact case-insensitive match.
          // A starts-with or contains hit from findByName is NOT a duplicate.
          const matches = ctx.self.menus.store.findByName(args.name);
          const exactMatch = matches.find((m) => m.name.toLowerCase() === args.name.toLowerCase());
          if (exactMatch !== undefined) {
            return textResult(
              `A menu named "${exactMatch.name}" already exists (UID: ${exactMatch.uid}). ` +
                `Use update_menu to change it.`,
            );
          }

          // Next free orderFlag so the new menu sorts after existing ones in Paprika order.
          const maxOrderFlag = ctx.self.menus.store.getAll().reduce((max, m) => Math.max(max, m.orderFlag), -1);
          const uid = MenuUidSchema.parse(crypto.randomUUID().toUpperCase());
          const newMenu: Menu = {
            uid,
            name: args.name,
            days,
            orderFlag: maxOrderFlag + 1,
            notes,
            deleted: false,
          };

          try {
            const saved = await ctx.infra.client.saveMenus([newMenu]);
            const created = saved[0] ?? newMenu;
            await ctx.self.commitMenu(created);
            return textResult(menuToMarkdown(created, [], ctx.deps["meal-type"].getAll()));
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, name: args.name }, "saveMenus (create_menu) failed");
            return textResult(`Failed to create menu: ${message}`);
          }
        },
        (guard) => guard,
      );
    };
  },
);
