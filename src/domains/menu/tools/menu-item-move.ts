import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuItem } from "../menu-item/types.js";
import type { MenuState, MenuWrites } from "../module.js";
import type { Menu } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, toolResult } from "../../../shared/tools.js";
import { MenuItemUidSchema } from "../ids.js";
import { menuStartGuard } from "./guards.js";

// `.strict()` — moving a menu item to a different day is its own act: it can
// auto-extend the parent menu's span and re-sequences the item menu-wide, so it
// is not a plain field edit (that logic left update_menu_item for this verb).
export const moveMenuItemInputSchema = z
  .object({
    uid: MenuItemUidSchema.describe("UID of the menuitem to move"),
    day: z
      .number()
      .int()
      .positive()
      .describe("Destination 1-indexed day. Days beyond the menu's current span auto-extend the menu."),
  })
  .strict();

/**
 * `move_menu_item` — move a menu item to a different position or menu (an intent verb,
 * not a free-form edit).
 */
export const moveMenuItemTool = defineTool(
  {
    name: "move_menu_item",
    title: "Move a menu item to a different day",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    description:
      "Move a menu item to a different day within its menu, by UID. A day beyond the menu's current span " +
      "auto-extends the menu so the item stays visible, and the item is re-sequenced to the end of the " +
      "menu's order. To change a menu item's meal type or recipe link instead, use update_menu_item.",
    inputSchema: moveMenuItemInputSchema,
  },
  [menuStartGuard],
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type", MenuWrites>) => {
    const log = ctx.infra.log.child({ component: "move_menu_item" });
    return async (args) => {
      const uid = args.uid;
      const existing = ctx.state.items.store.get(uid);
      if (existing === undefined) {
        return toolResult(
          `No menu item found with UID "${uid}" (it may not exist or was already deleted). Use \`read_menu\` to inspect its menu.`,
        );
      }
      // Idempotent no-op: already on the requested day. Returning early avoids a
      // wasted POST + a pointless menu-wide re-sequence.
      if (args.day === existing.day) {
        return toolResult(`Menu item "${existing.name}" is already on day ${existing.day.toString()}.`);
      }

      const newDay = args.day;

      // (A) Auto-expand the parent menu when the move pushes the item past the
      // menu's current span — otherwise menuToMarkdown (Day 1..menu.days) silently
      // hides it. Mirrors add_menu_items' auto-expand. Skipped for an orphaned item
      // (menuUid null) or a menu not known locally.
      let extendedTo: number | null = null;
      if (existing.menuUid !== null) {
        const parent = ctx.state.menus.store.get(existing.menuUid);
        if (parent !== undefined && newDay > parent.days) {
          const expanded: Menu = { ...parent, days: newDay };
          const savedMenus = (await ctx.infra.client.saveMenus([expanded])).match(
            (v) => v,
            (e) => {
              log.error({ err: e, uid }, "saveMenus (move_menu_item auto-expand) failed");
              return toolResult(
                `Failed to extend the menu to ${newDay.toString()} day(s) for the move: ${e.message}. ` +
                  `The item was not moved.`,
              );
            },
          );
          if ("content" in savedMenus) return savedMenus;
          const commitErr = commitFailure("menu", await ctx.writes.commitMenu(savedMenus[0] ?? expanded));
          if (commitErr) return commitErr;
          extendedTo = newDay;
        }
      }

      // (B) Re-sequence the moved item to the END of the menu's order_flag run
      // (menu-wide max + 1, excluding the item itself). order_flag is menu-wide —
      // not per-day — per the wire capture (docs/wire-captures/menus.har.json),
      // so this keeps it unique and places the move last.
      let newOrderFlag = existing.orderFlag;
      if (existing.menuUid !== null) {
        const others = ctx.state.items.store.getByMenuUid(existing.menuUid).filter((it) => it.uid !== existing.uid);
        newOrderFlag = others.reduce((max, it) => Math.max(max, it.orderFlag), -1) + 1;
      }

      const moved: MenuItem = { ...existing, day: newDay, orderFlag: newOrderFlag };

      const saved = (await ctx.infra.client.saveMenuItems([moved])).match(
        (items) => items[0]!,
        (e) => {
          log.error({ err: e, uid }, "saveMenuItems (move_menu_item) failed");
          return toolResult(`Failed to move menu item: ${e.message}`);
        },
      );
      if ("content" in saved) return saved;
      const commitErr = commitFailure("menu", await ctx.writes.commitMenuItem(saved));
      if (commitErr) return commitErr;

      const extendNote = extendedTo !== null ? `Extended the menu to ${extendedTo.toString()} day(s). ` : "";
      return toolResult(`${extendNote}Menu item "${saved.name}" moved to day ${saved.day.toString()}.`);
    };
  },
);
