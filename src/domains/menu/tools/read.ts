import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuSelf } from "../module.js";

import { MenuUidSchema } from "../../../ids.js";
import { formatLookupOutcome, resolveLookup, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { menuToMarkdown } from "../menu-helpers.js";
import { menuStartGuard } from "./guards.js";

/**
 * Registers `read_menu`, kernel-shaped — reads this module's own menu + menu-item
 * stores via `ctx.self`, and the meal-type catalog (for name/order rendering) via
 * `ctx.deps["meal-type"].getAll()`.
 */
export function readMenuTool(ctx: DomainCtx<MenuSelf, "recipe" | "meal-type">): void {
  const log = ctx.infra.log.child({ component: "read_menu" });
  ctx.server.registerTool(
    "read_menu",
    {
      title: "Read a menu and its items",
      annotations: { readOnlyHint: true, idempotentHint: true },
      description:
        "Get a menu by UID or name, rendered day by day with each day's planned recipes. " +
        "Name lookup is tiered (exact → starts-with → contains) and case-insensitive, with a " +
        "disambiguation list when multiple menus match the same tier. Each recipe line carries " +
        "its menuitem and recipe UIDs so you can drive update_menu_item / delete_menu_item. " +
        'Pass exactly one shape: {"uid": "..."} or {"name": "..."}.',
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
      log.info({ tool: "read_menu", ...args.lookup }, "tool invoked");
      return menuStartGuard(ctx).match(
        (): CallToolResult => {
          const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.name };
          const outcome = resolveLookup(query, {
            get: (uid) => ctx.self.menus.store.get(uid),
            findByText: (text) => ctx.self.menus.store.findByName(text),
          });
          return formatLookupOutcome(outcome, {
            entityNoun: "menu",
            renderOne: (menu) =>
              menuToMarkdown(menu, ctx.self.items.store.getByMenuUid(menu.uid), ctx.deps["meal-type"].getAll(), {
                includeItemUids: true,
              }),
            disambiguationLine: (menu) => `- **${menu.name}** (uid: \`${menu.uid}\`)`,
          });
        },
        (guard) => guard,
      );
    },
  );
}
