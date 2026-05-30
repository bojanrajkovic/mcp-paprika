import { toMessage } from "../utils/log.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MenuUidSchema } from "../paprika/types.js";
import type { Menu } from "../paprika/types.js";
import { commitMenu, commitMenuItemsBatch, menuStartGuard, menuToMarkdown } from "./menu-helpers.js";
import { resolveLookup, textResult, uidOrTextLookupSchema } from "./helpers.js";
import type { ServerContext } from "../types/server-context.js";

export function registerCreateMenuTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "create_menu" });
  server.registerTool(
    "create_menu",
    {
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
    async (args) => {
      // `.default()` is applied by the MCP SDK's Zod parse; fall back here so the
      // handler is robust to direct invocation (tests) that bypasses the schema.
      const days = args.days ?? 1;
      const notes = args.notes ?? "";
      log.info({ tool: "create_menu", name: args.name, days }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          // Duplicate-name guard: only reject on exact case-insensitive match.
          // A starts-with or contains hit from findByName is NOT a duplicate.
          const matches = ctx.menuStore.findByName(args.name);
          const exactMatch = matches.find((m) => m.name.toLowerCase() === args.name.toLowerCase());
          if (exactMatch !== undefined) {
            return textResult(
              `A menu named "${exactMatch.name}" already exists (UID: ${exactMatch.uid}). ` +
                `Use update_menu to change it.`,
            );
          }

          // Next free orderFlag so the new menu sorts after existing ones in Paprika order.
          const maxOrderFlag = ctx.menuStore.getAll().reduce((max, m) => Math.max(max, m.orderFlag), -1);
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
            const saved = await ctx.client.saveMenus([newMenu]);
            const created = saved[0] ?? newMenu;
            await commitMenu(ctx, created);
            return textResult(menuToMarkdown(created, [], ctx.mealTypeStore.getAll()));
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, name: args.name }, "saveMenus (create_menu) failed");
            return textResult(`Failed to create menu: ${message}`);
          }
        },
        (guard) => guard,
      );
    },
  );
}

export function registerUpdateMenuTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "update_menu" });
  server.registerTool(
    "update_menu",
    {
      description:
        "Update a menu's name, day span, and/or notes. Look it up by UID or name (tiered fuzzy match, " +
        "case-insensitive). Provide at least one of name, days, or notes. Shrinking days below the highest " +
        "day that already has a planned recipe is rejected (the conflicting recipes are named) — move or " +
        "delete those menuitems first. " +
        'Pass exactly one lookup shape: {"uid": "..."} or {"name": "..."}.',
      inputSchema: {
        lookup: uidOrTextLookupSchema({
          uidSchema: MenuUidSchema,
          textKey: "name",
          entityLabel: "menu",
          textExample: "Thanksgiving Dinner",
        }),
        name: z.string().min(1).optional().describe("New menu name"),
        days: z.number().int().positive().optional().describe("New day span (>= 1)"),
        notes: z.string().optional().describe("New free-text notes"),
      },
    },
    async (args) => {
      log.info({ tool: "update_menu", ...args.lookup }, "tool invoked");
      return menuStartGuard(ctx).match(
        async (): Promise<CallToolResult> => {
          if (args.name === undefined && args.days === undefined && args.notes === undefined) {
            return textResult("Nothing to update. Provide at least one of name, days, or notes.");
          }

          const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.name };
          const outcome = resolveLookup(query, {
            get: (uid) => ctx.menuStore.get(uid),
            findByText: (text) => ctx.menuStore.findByName(text),
          });

          // Only a single resolved menu can be mutated; misses and disambiguation
          // return the standard wording without touching the network.
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

          // Days-shrink guard: refuse to orphan menuitems that would fall outside the
          // new span. maxDay is the highest day among live items; conflicts are the
          // items whose day exceeds the requested span.
          if (args.days !== undefined) {
            const liveItems = ctx.menuItemStore.getByMenuUid(existing.uid);
            const conflicts = liveItems.filter((item) => item.day > args.days!);
            if (conflicts.length > 0) {
              const maxDay = liveItems.reduce((max, item) => Math.max(max, item.day), 0);
              const conflictLines = conflicts
                .slice()
                .sort((a, b) => a.day - b.day)
                .map((item) => `- "${item.name}" on day ${item.day.toString()}`);
              return textResult(
                `Cannot shrink "${existing.name}" to ${args.days.toString()} day(s): ` +
                  `${conflicts.length.toString()} planned recipe(s) fall on later days ` +
                  `(planned recipes currently span ${maxDay.toString()} day(s)).\n` +
                  `${conflictLines.join("\n")}\n\n` +
                  `Move or delete those menuitems first, then shrink the menu.`,
              );
            }
          }

          const merged: Menu = {
            ...existing,
            name: args.name ?? existing.name,
            days: args.days ?? existing.days,
            notes: args.notes ?? existing.notes,
          };

          try {
            const saved = await ctx.client.saveMenus([merged]);
            const persisted = saved[0] ?? merged;
            await commitMenu(ctx, persisted);
            return textResult(
              menuToMarkdown(persisted, ctx.menuItemStore.getByMenuUid(persisted.uid), ctx.mealTypeStore.getAll()),
            );
          } catch (error) {
            const message = toMessage(error);
            log.error({ err: error, uid: existing.uid }, "saveMenus (update_menu) failed");
            return textResult(`Failed to update menu: ${message}`);
          }
        },
        (guard) => guard,
      );
    },
  );
}

export function registerDeleteMenuTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "delete_menu" });
  server.registerTool(
    "delete_menu",
    {
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
            get: (uid) => ctx.menuStore.get(uid),
            findByText: (text) => ctx.menuStore.findByName(text),
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
          const items = ctx.menuItemStore.getByMenuUid(existing.uid);

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
              const savedItems = await ctx.client.saveMenuItems(trashedItems);
              await commitMenuItemsBatch(ctx, savedItems);
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
            const saved = await ctx.client.saveMenus([trashedMenu]);
            const persisted = saved[0] ?? trashedMenu;
            await commitMenu(ctx, persisted);
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
