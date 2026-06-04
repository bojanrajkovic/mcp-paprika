import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { MenuUid } from "../../../ids.js";
import type { DomainCtx } from "../../../kernel/registry.js";
import type { MenuSelf } from "../module.js";

import { menuToMarkdown } from "../../../tools/menu-helpers.js";

/**
 * Registers `paprika://menu/{uid}`, kernel-shaped — reads this module's own menu +
 * menu-item stores via `ctx.self`, and the meal-type catalog (for item name/order
 * rendering) via `ctx.deps["meal-type"].getAll()`. Menu is one of the three
 * Content-class entities with a resource surface (ADR-0004); a child menu-item
 * change fires `resourceListChanged()` because items are inlined here.
 *
 * Recipe references are NOT read — recipe linkage is denormalized onto
 * `MenuItem.name` at write time, so the resource needs only the meal-type dep of its
 * two declared deps. Lifted verbatim from `src/resources/menus.ts`.
 */
export function menuResource(ctx: DomainCtx<MenuSelf, "recipe" | "meal-type">): void {
  const template = new ResourceTemplate("paprika://menu/{uid}", {
    list: async () => {
      const menus = ctx.self.menus.store.getAll();
      return {
        resources: menus.map((menu) => ({
          uri: `paprika://menu/${menu.uid}`,
          name: menu.name,
          mimeType: "text/markdown",
        })),
      };
    },
  });

  ctx.server.registerResource(
    "menus",
    template,
    { description: "Paprika menus accessible by UID" },
    async (uri, variables) => {
      const uid = variables["uid"] as MenuUid;
      const menu = ctx.self.menus.store.get(uid);
      if (!menu) {
        throw new Error(`Menu not found: ${uid}`);
      }

      const items = ctx.self.items.store.getByMenuUid(uid);

      const headerLines = [`**UID:** \`${uid}\``, `**URI:** \`paprika://menu/${uid}\``];

      const lastSynced = ctx.self.menus.store.lastSyncedAt;
      if (lastSynced) {
        headerLines.push(`**Last synced:** ${lastSynced.toISOString()}`);
      }

      const body = menuToMarkdown(menu, items, ctx.deps["meal-type"].getAll(), { includeItemUids: false });
      const content = `${headerLines.join("\n")}\n\n${body}`;
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text: content,
          },
        ],
      };
    },
  );
}
