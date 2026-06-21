import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuState } from "../module.js";

import { defineTool } from "../../../kernel/tool.js";
import { resolveLookup, resolveOrPick, toolResult, uidOrTextLookupSchema } from "../../../shared/tools.js";
import { MenuUidSchema } from "../ids.js";
import { menuReadOutputSchema, menuToMarkdown, menuToStructured } from "../menu-helpers.js";
import { menuStartGuard } from "./guards.js";

/**
 * `read_menu` — read a menu with its items inlined. Resolves the meal-type catalog
 * (for name/order rendering) via `ctx.deps["meal-type"].getAll()`.
 */
export const readMenuTool = defineTool(
  {
    name: "read_menu",
    title: "Read a menu and its items",
    annotations: { readOnlyHint: true, idempotentHint: true },
    description:
      "Get a menu by UID or name, rendered day by day with each day's planned recipes. " +
      "Name lookup is tiered (exact → starts-with → contains) and case-insensitive, with a " +
      "disambiguation list when multiple menus match the same tier. Each item's menuitem and recipe " +
      "UIDs are returned so you can drive update_menu_item / delete_menu_item. " +
      'Pass exactly one shape: {"uid": "..."} or {"name": "..."}.',
    inputSchema: {
      lookup: uidOrTextLookupSchema({
        uidSchema: MenuUidSchema,
        textKey: "name",
        entityLabel: "menu",
        textExample: "Thanksgiving Dinner",
      }),
    },
    outputSchema: menuReadOutputSchema,
  },
  [menuStartGuard],
  (ctx: DomainCtx<MenuState, "recipe" | "meal-type">) => {
    return async (args) => {
      const query = "uid" in args.lookup ? { uid: args.lookup.uid } : { text: args.lookup.name };
      const outcome = resolveLookup(query, {
        get: (uid) => ctx.state.menus.store.get(uid),
        findByText: (text) => ctx.state.menus.store.findByName(text),
      });
      const resolved = await resolveOrPick(ctx.server.server, outcome, {
        entityNoun: "menu",
        describe: (menu) => ({ uid: menu.uid, label: menu.name }),
        findWith: "list_menus",
        log: ctx.infra.log,
      });
      if ("result" in resolved) return resolved.result;
      const items = ctx.state.items.store.getByMenuUid(resolved.entity.uid);
      const mealTypes = ctx.deps["meal-type"].getAll();
      return toolResult(
        menuToMarkdown(resolved.entity, items, mealTypes),
        menuToStructured(resolved.entity, items, mealTypes),
      );
    };
  },
);
