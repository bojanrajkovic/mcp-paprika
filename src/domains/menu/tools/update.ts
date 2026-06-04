import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuSelf } from "../module.js";
import type { Menu } from "../types.js";

import { MenuUidSchema } from "../../../ids.js";
import { resolveLookup, textResult, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { toMessage } from "../../../utils/log.js";
import { menuToMarkdown } from "../menu-helpers.js";
import { menuStartGuard } from "./guards.js";

/**
 * Registers `update_menu`, kernel-shaped — reads/writes this module's own menu +
 * menu-item stores via `ctx.self`, commits through `ctx.self.commitMenu`, and renders
 * with the meal-type catalog from `ctx.deps["meal-type"]`. Lifted verbatim from
 * `src/tools/menu-write.ts`.
 */
export function updateMenuTool(ctx: DomainCtx<MenuSelf, "recipe" | "meal-type">): void {
  const log = ctx.infra.log.child({ component: "update_menu" });
  ctx.server.registerTool(
    "update_menu",
    {
      title: "Edit a menu",
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      description:
        "Update a menu's name, day span, and/or notes. Look it up by UID or name (tiered fuzzy match, " +
        "case-insensitive). Provide at least one of name, days, or notes. Renaming to a name already used " +
        "by a different menu is rejected (the existing UID is surfaced). Shrinking days below the highest " +
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
            get: (uid) => ctx.self.menus.store.get(uid),
            findByText: (text) => ctx.self.menus.store.findByName(text),
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

          // Name-conflict guard: reject a rename that collides with a DIFFERENT menu
          // (mirrors create_menu's duplicate guard and rename_grocery_list). A no-op
          // rename to the menu's own current name is allowed and falls through.
          if (args.name !== undefined) {
            const newName = args.name;
            if (newName.toLowerCase() !== existing.name.toLowerCase()) {
              const conflict = ctx.self.menus.store
                .findByName(newName)
                .find((m) => m.name.toLowerCase() === newName.toLowerCase() && m.uid !== existing.uid);
              if (conflict !== undefined) {
                return textResult(
                  `A menu named "${conflict.name}" already exists (UID: ${conflict.uid}). Choose a different name.`,
                );
              }
            }
          }

          // Days-shrink guard: refuse to orphan menuitems that would fall outside the
          // new span. maxDay is the highest day among live items; conflicts are the
          // items whose day exceeds the requested span.
          if (args.days !== undefined) {
            const liveItems = ctx.self.items.store.getByMenuUid(existing.uid);
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
            const saved = await ctx.infra.client.saveMenus([merged]);
            const persisted = saved[0] ?? merged;
            await ctx.self.commitMenu(persisted);
            return textResult(
              menuToMarkdown(
                persisted,
                ctx.self.items.store.getByMenuUid(persisted.uid),
                ctx.deps["meal-type"].getAll(),
              ),
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
