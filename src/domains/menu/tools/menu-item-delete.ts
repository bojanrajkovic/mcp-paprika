import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuItem } from "../menu-item/types.js";
import type { MenuState } from "../module.js";

import { MenuItemUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { menuStartGuard } from "./guards.js";

export const deleteMenuItemInputSchema = z.object({
  uid: MenuItemUidSchema.describe("Menu item UID to delete"),
});

/**
 * Registers `delete_menu_item`, kernel-shaped — reads/writes this module's own
 * menu-item store via `ctx.state`, committing through `ctx.state.commitMenuItem`.
 */
export const deleteMenuItemTool = defineTool(
  {
    name: "delete_menu_item",
    title: "Delete a menu item",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    description:
      "Soft-delete a menuitem (a planned recipe) from a menu by UID. Idempotent: a second delete on the " +
      "same UID returns a friendly 'already deleted' message without re-POSTing. Requires an exact UID.",
    inputSchema: deleteMenuItemInputSchema.shape,
  },
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type">) => {
    const log = ctx.infra.log.child({ component: "delete_menu_item" });
    return async (args) => {
      log.info({ tool: "delete_menu_item", uid: args.uid }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const uid = args.uid;
          const existing = ctx.state.items.store.get(uid);

          if (existing === undefined) {
            return textResult(`No menu item found with UID "${uid}" (it may not exist or was already deleted).`);
          }
          const trashed: MenuItem = { ...existing, deleted: true };
          try {
            const saved = (await ctx.infra.client.saveMenuItems([trashed]))[0]!;
            await ctx.state.commitMenuItem(saved);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid }, "saveMenuItems (delete_menu_item) failed");
            return textResult(`Failed to delete menu item: ${message}`);
          }

          return textResult(`Menu item "${existing.name}" has been deleted.`);
        },
        (guard) => guard,
      );
    };
  },
);
