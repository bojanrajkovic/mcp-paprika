import { z } from "zod";

import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { toolResult } from "../../../shared/tools.js";
import { MenuUidSchema } from "../ids.js";
import { menuStartGuard } from "./guards.js";

// Structured-output payload (ADR-0019, R1): a menu row per saved menu, carrying the
// `uid` read_menu / schedule_menu / delete_menu consume plus the item count and span.
export const listMenusOutputSchema = z.object({
  items: z.array(
    z.object({
      uid: MenuUidSchema,
      name: z.string(),
      itemCount: z.number().int().nonnegative(),
      days: z.number().int().nonnegative(),
    }),
  ),
});

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
    outputSchema: listMenusOutputSchema,
  },
  [menuStartGuard],
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type">) => {
    return () => {
      const all = ctx.state.menus.store
        .getAll()
        .sort((a, b) => a.orderFlag - b.orderFlag || a.name.localeCompare(b.name));

      if (all.length === 0) {
        return toolResult("No menus found.", { items: [] });
      }

      // Item count resolved once per menu, feeding both the text and the structured row.
      const items = all.map((menu) => ({
        uid: menu.uid,
        name: menu.name,
        itemCount: ctx.state.items.store.getByMenuUid(menu.uid).length,
        days: menu.days,
      }));
      const lines = items.map((m) => {
        const dayLabel = m.days === 1 ? "day" : "days";
        return `- **${m.name}** (${m.itemCount.toString()} items, ${m.days.toString()} ${dayLabel}) — \`${m.uid}\``;
      });

      return toolResult(lines.join("\n"), { items });
    };
  },
);
