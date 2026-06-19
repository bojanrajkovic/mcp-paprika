import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuState, MenuWrites } from "../module.js";
import type { Menu } from "../types.js";

import { defineTool } from "../../../kernel/tool.js";
import { commitFailure, resolveLookup, toolResult, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { MenuUidSchema } from "../ids.js";
import { menuStartGuard } from "./guards.js";

/**
 * `delete_menu` — delete a menu, cascading the soft-delete to its items.
 */
export const deleteMenuTool = defineTool(
  {
    name: "delete_menu",
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
  [menuStartGuard],
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type", MenuWrites>) => {
    const log = ctx.infra.log.child({ component: "delete_menu" });
    return async (args) => {
      const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.name };
      const outcome = resolveLookup(query, {
        get: (uid) => ctx.state.menus.store.get(uid),
        findByText: (text) => ctx.state.menus.store.findByName(text),
      });

      if (outcome.kind === "uid_miss") {
        return toolResult(`No menu found with UID "${outcome.uid}" (it may not exist or was already deleted).`);
      }
      if (outcome.kind === "text_none") {
        return toolResult(`No menus found matching "${outcome.text}".`);
      }
      if (outcome.kind === "text_many") {
        const list = outcome.matches.map((menu) => `- **${menu.name}** (uid: \`${menu.uid}\`)`).join("\n");
        return toolResult(`Multiple menus match "${outcome.text}":\n${list}\n\nPlease re-invoke with a specific uid.`);
      }

      const existing = outcome.entity;
      const items = ctx.state.items.store.getByMenuUid(existing.uid);

      // Cascade: tombstone the menuitems FIRST (children before parent), so a
      // failure to tombstone the menu leaves orphaned-but-visible items the next
      // sync can reconcile rather than a parent with invisible children.
      if (items.length > 0) {
        // Null the back-reference on each tombstone: the Paprika app's cascade
        // posts menu_uid: null when a menu's soft-delete removes its items (see
        // docs/wire-captures/menus.har.json "cascade delete menuitem after menu
        // deletion"). This is the case MenuItem.menuUid is nullable for.
        const trashedItems = items.map((item) => ({ ...item, menuUid: null, deleted: true }));
        const savedItems = (await ctx.infra.client.saveMenuItems(trashedItems)).match(
          (v) => v,
          (e) => {
            log.error({ err: e, uid: existing.uid }, "saveMenuItems (delete_menu cascade) failed");
            return toolResult(
              `Failed to delete the recipes in menu "${existing.name}": ${e.message}. ` +
                `The menu was NOT deleted. Try again.`,
            );
          },
        );
        if ("content" in savedItems) return savedItems;
        const commitErr = commitFailure("menu", await ctx.writes.commitMenuItemsBatch(savedItems));
        if (commitErr) return commitErr;
      }

      const trashedMenu: Menu = { ...existing, deleted: true };
      const savedMenus = (await ctx.infra.client.saveMenus([trashedMenu])).match(
        (v) => v,
        (e) => {
          log.error({ err: e, uid: existing.uid }, "saveMenus (delete_menu) failed");
          return toolResult(
            `Deleted the ${items.length.toString()} recipe(s) in menu "${existing.name}", but failed to ` +
              `delete the menu itself: ${e.message}. The next sync should reconcile it; you can also retry.`,
          );
        },
      );
      if ("content" in savedMenus) return savedMenus;
      const persisted = savedMenus[0] ?? trashedMenu;
      const commitErr = commitFailure("menu", await ctx.writes.commitMenu(persisted));
      if (commitErr) return commitErr;

      const itemNote = items.length > 0 ? ` and its ${items.length.toString()} planned recipe(s)` : "";
      return toolResult(`Menu "${existing.name}"${itemNote} has been deleted.`);
    };
  },
);
