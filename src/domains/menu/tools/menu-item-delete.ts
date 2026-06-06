import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuItem } from "../menu-item/types.js";
import type { MenuState, MenuWrites } from "../module.js";

import { MenuItemUidSchema } from "../../../ids.js";
import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, textResult } from "../../../shared/tools.js";
import { menuStartGuard } from "./guards.js";

export const deleteMenuItemInputSchema = z.object({
  uid: MenuItemUidSchema.describe("Menu item UID to delete"),
});

/**
 * `delete_menu_item` — remove an item from a menu (soft-delete).
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
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type", MenuWrites>) => {
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
          return (await ctx.infra.client.saveMenuItems([trashed])).match(
            async (items): Promise<CallToolResult> => {
              const commitErr = commitFailure("menu", await ctx.writes.commitMenuItem(items[0]!));
              if (commitErr) return commitErr;
              return textResult(`Menu item "${existing.name}" has been deleted.`);
            },
            async (e) => {
              log.error({ err: e, uid }, "saveMenuItems (delete_menu_item) failed");
              return textResult(`Failed to delete menu item: ${e.message}`);
            },
          );
        },
        (guard) => guard,
      );
    };
  },
);
