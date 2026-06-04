import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../kernel/registry.js";
import type { MenuSelf } from "../module.js";
import type { Menu } from "../types.js";

import { MenuUidSchema } from "../../ids.js";
import { resolveLookup, textResult, uidOrTextLookupSchema } from "../../tools/helpers.js";
import { toMessage } from "../../utils/log.js";
import { menuStartGuard } from "./guards.js";

/**
 * Registers `delete_menu`, kernel-shaped — reads/writes this module's own menu +
 * menu-item stores via `ctx.self`, cascading through `ctx.self.commitMenuItemsBatch`
 * + `ctx.self.commitMenu`. Lifted verbatim from `src/tools/menu-write.ts`.
 */
export function deleteMenuTool(ctx: DomainCtx<MenuSelf, "recipe" | "meal-type">): void {
  const log = ctx.infra.log.child({ component: "delete_menu" });
  ctx.server.registerTool(
    "delete_menu",
    {
      title: "Delete a menu",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      description:
        "Delete a menu and all of its planned recipes (menuitems). Look it up by UID or name (tiered fuzzy " +
        "match, case-insensitive). The menuitems are tombstoned first, then the menu itself. " +
        'Pass exactly one lookup shape: {"uid": "..."} or {"name": "..."}.',
      inputSchema: {
        lookup: uidOrTextLookupSchema({
          uidSchema: MenuUidSchema,
          textKey: "name",
          entityLabel: "menu",
          textExample: "Thanksgiving Dinner",
        }),
      },
    },
    async (args) => {
      log.info({ tool: "delete_menu", ...args.lookup }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.name };
          const outcome = resolveLookup(query, {
            get: (uid) => ctx.self.menus.store.get(uid),
            findByText: (text) => ctx.self.menus.store.findByName(text),
          });

          if (outcome.kind === "uid_miss") {
            return textResult(`No menu found with UID "${outcome.uid}".`);
          }
          if (outcome.kind === "text_none") {
            return textResult(`No menus found matching "${outcome.text}".`);
          }
          if (outcome.kind === "text_many") {
            const list = outcome.matches.map((menu) => `- **${menu.name}** (uid: \`${menu.uid}\`)`).join("\n");
            return textResult(
              `Multiple menus match "${outcome.text}":\n${list}\n\nPlease re-invoke with a specific uid.`,
            );
          }

          const existing = outcome.entity;
          const items = ctx.self.items.store.getByMenuUid(existing.uid);

          // Cascade: tombstone the menuitems FIRST (children before parent), so a
          // failure to tombstone the menu leaves orphaned-but-visible items the next
          // sync can reconcile rather than a parent with invisible children.
          if (items.length > 0) {
            // Null the back-reference on each tombstone: the Paprika app's cascade
            // posts menu_uid: null when a menu's soft-delete removes its items (see
            // docs/wire-captures/menus.har.json "cascade delete menuitem after menu
            // deletion"). This is the case MenuItem.menuUid is nullable for.
            const trashedItems = items.map((item) => ({ ...item, menuUid: null, deleted: true }));
            try {
              const savedItems = await ctx.infra.client.saveMenuItems(trashedItems);
              await ctx.self.commitMenuItemsBatch(savedItems);
            } catch (error) {
              const message = toMessage(error);
              log.error({ err: error, uid: existing.uid }, "saveMenuItems (delete_menu cascade) failed");
              return textResult(
                `Failed to delete the recipes in menu "${existing.name}": ${message}. ` +
                  `The menu was NOT deleted. Try again.`,
              );
            }
          }

          const trashedMenu: Menu = { ...existing, deleted: true };
          try {
            const saved = await ctx.infra.client.saveMenus([trashedMenu]);
            const persisted = saved[0] ?? trashedMenu;
            await ctx.self.commitMenu(persisted);
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: existing.uid }, "saveMenus (delete_menu) failed");
            return textResult(
              `Deleted the ${items.length.toString()} recipe(s) in menu "${existing.name}", but failed to ` +
                `delete the menu itself: ${message}. The next sync should reconcile it; you can also retry.`,
            );
          }

          const itemNote = items.length > 0 ? ` and its ${items.length.toString()} planned recipe(s)` : "";
          return textResult(`Menu "${existing.name}"${itemNote} has been deleted.`);
        },
        (guard) => guard,
      );
    },
  );
}
