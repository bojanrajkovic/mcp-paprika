import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { textResult } from "../../../shared/tools.js";
import { menuStartGuard } from "./guards.js";

/**
 * `list_menus` — list all menus.
 */
export const listMenusTool = defineTool(
  {
    name: "list_menus",
    title: "List your menus",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "List all menus (saved meal plans) in Paprika order, with item count and day span per menu. " +
      "Use read_menu to see a menu's full day-by-day breakdown.",
    inputSchema: {},
  },
  [menuStartGuard],
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type">) => {
    return () => {
      const all = ctx.state.menus.store
        .getAll()
        .sort((a, b) => a.orderFlag - b.orderFlag || a.name.localeCompare(b.name));

      if (all.length === 0) {
        return textResult("No menus found.");
      }

      const lines = all.map((menu) => {
        const itemCount = ctx.state.items.store.getByMenuUid(menu.uid).length;
        const dayLabel = menu.days === 1 ? "day" : "days";
        return `- **${menu.name}** (${itemCount.toString()} items, ${menu.days.toString()} ${dayLabel}) — \`${menu.uid}\``;
      });

      return textResult(lines.join("\n"));
    };
  },
);
