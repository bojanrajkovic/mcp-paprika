import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MenuUidSchema } from "../ids.js";
import type { ServerContext } from "../types/server-context.js";
import { formatLookupOutcome, resolveLookup, textResult, uidOrTextLookupSchema } from "./helpers.js";
import { menuStartGuard, menuToMarkdown } from "./menu-helpers.js";

export function registerListMenusTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "list_menus" });
  server.registerTool(
    "list_menus",
    {
      description:
        "List all menus (saved meal plans) in Paprika order, with item count and day span per menu. " +
        "Use read_menu to see a menu's full day-by-day breakdown.",
      inputSchema: {},
    },
    async () => {
      log.info({ tool: "list_menus" }, "tool invoked");
      return menuStartGuard(ctx).match(
        (): CallToolResult => {
          const all = ctx.menuStore.getAll().sort((a, b) => a.orderFlag - b.orderFlag || a.name.localeCompare(b.name));

          if (all.length === 0) {
            return textResult("No menus found.");
          }

          const lines = all.map((menu) => {
            const itemCount = ctx.menuItemStore.getByMenuUid(menu.uid).length;
            const dayLabel = menu.days === 1 ? "day" : "days";
            return `- **${menu.name}** (${itemCount.toString()} items, ${menu.days.toString()} ${dayLabel}) — \`${menu.uid}\``;
          });

          return textResult(lines.join("\n"));
        },
        (guard) => guard,
      );
    },
  );
}

export function registerReadMenuTool(server: McpServer, ctx: ServerContext): void {
  const log = ctx.log.child({ component: "read_menu" });
  server.registerTool(
    "read_menu",
    {
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
            get: (uid) => ctx.menuStore.get(uid),
            findByText: (text) => ctx.menuStore.findByName(text),
          });
          return formatLookupOutcome(outcome, {
            entityNoun: "menu",
            renderOne: (menu) =>
              menuToMarkdown(menu, ctx.menuItemStore.getByMenuUid(menu.uid), ctx.mealTypeStore.getAll(), {
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
