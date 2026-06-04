import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuSelf } from "../module.js";

import { textResult } from "../../../tools/helpers.js";
import { menuStartGuard } from "./guards.js";

/**
 * Registers `list_menus`, kernel-shaped — reads this module's own menu + menu-item
 * stores via `ctx.self`. Lifted verbatim from `src/tools/menu-read.ts`.
 */
export function listMenusTool(ctx: DomainCtx<MenuSelf, "recipe" | "meal-type">): void {
  const log = ctx.infra.log.child({ component: "list_menus" });
  ctx.server.registerTool(
    "list_menus",
    {
      title: "List your menus",
      annotations: { readOnlyHint: true, idempotentHint: true },
      description:
        "List all menus (saved meal plans) in Paprika order, with item count and day span per menu. " +
        "Use read_menu to see a menu's full day-by-day breakdown.",
      inputSchema: {},
    },
    async () => {
      log.info({ tool: "list_menus" }, "tool invoked");
      return menuStartGuard(ctx).match(
        (): CallToolResult => {
          const all = ctx.self.menus.store
            .getAll()
            .sort((a, b) => a.orderFlag - b.orderFlag || a.name.localeCompare(b.name));

          if (all.length === 0) {
            return textResult("No menus found.");
          }

          const lines = all.map((menu) => {
            const itemCount = ctx.self.items.store.getByMenuUid(menu.uid).length;
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
